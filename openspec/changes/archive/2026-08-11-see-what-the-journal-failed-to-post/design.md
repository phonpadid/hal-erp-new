## Context

Posting is fire-and-forget today.

```
business txn commits ──► event emitted ──► listener ──► posting
   (durable)              (in-process)      (try/catch)   (idempotent)
                               │                 │
                               │                 └── on failure: logger.error, and nothing else
                               └── process dies here: nothing runs, nothing logs, nothing knows
```

Three properties are missing, and only one of them is "retry":

| question | answerable today |
|---|---|
| did this posting fail? | only by reading logs |
| *which* postings are owed and missing? | no |
| did a posting get lost without ever being attempted? | no — there is no record it was owed |

The repository already contains the answer to the retry half. `successor-outbox` records an
obligation atomically with the approval, drains it in a sweep, claims rows with
`PESSIMISTIC_WRITE` + `SKIP LOCKED`, bounds `attempts`, and leaves a `FAILED` row queryable with its
`last_error`. That spec is the model here, with one deliberate divergence (D1).

## Goals / Non-Goals

**Goals:**

- An undelivered posting is a queryable state, not a log line.
- A posting lost to a restart is found, not merely retried when someone notices.
- Every `journal_entry` is balanced by a check, not by an argument.
- One point of construction, so the accounting-period guard has somewhere to live.

**Non-Goals:**

- Changing when or what any path posts. The amounts, accounts, source keys and instants are
  untouched; only the surrounding bookkeeping is added.
- Making a posting failure affect the business transaction. It must stay swallowed — that contract
  is the reason the GL is allowed to run post-commit at all.
- Reversing entries (see the proposal's out-of-scope; no caller exists).

## Decisions

### D1 — The journal is the authority on "done"; the row is only a record of trouble

`successor-outbox` needs its table to be the source of truth because "was this successor created?"
cannot be answered from the successor: a `PO` exists for many reasons. The GL is different —
`journal_entry` is already unique on `(company_id, source_type, source_id)`, so *the ledger itself
answers whether the work is done*.

That changes what the new table is for:

```
successor-outbox            gl_posting_attempt
─────────────────           ──────────────────
row = the obligation        entry = the obligation's proof
row absent → not owed       row absent → nothing has been ATTEMPTED yet (not "not owed")
DONE means done             POSTED is an echo; the entry is what makes it true
```

The practical consequence: the row does not have to be written inside the business transaction.
`pending_successor` must be, because losing the row loses the obligation. Here, losing the row loses
only the error message — the obligation is still visible as "a settled payment with no entry". That
is what lets this change stay inside the GL module instead of reaching into the payment, approval
and stock commit paths.

The cost is that a source never attempted has no row, so it cannot be found by reading the table.
That is what D3 exists for.

### D2 — `SKIPPED` is recorded, never inferred

Several sources legitimately produce no entry:

- a settled document with no `budget_txn` ACTUAL (`postForPayment` warns and returns)
- an accruing document that cut no budget (`postAccrualForApproval` warns and returns)
- a `RESERVE` or `RELEASE` stock row, and an intra-company transfer (both net to nothing)

A reconciliation query that asks "which settled payments have no entry?" would return every one of
these forever. The obvious fix — teach the query the same exclusion rules — is the wrong one: it
duplicates business logic that already lives in the service, in a second language (SQL), where the
two can drift apart silently and the symptom is a permanently noisy operations screen that people
learn to ignore.

So the service records `SKIPPED` as a **terminal** outcome, and the query becomes:

```
owed and undelivered = source has no journal_entry
                       AND has no gl_posting_attempt row in a terminal state (POSTED | SKIPPED)
```

The skip rules stay in exactly one place, and the query never needs to know them.

`SKIPPED` is also information in its own right. "This settlement posted nothing because it carried
no ACTUAL" is a sentence an accountant may want to challenge; today it is a warning in a log.

### D3 — The timer both retries and reconciles

Two failure shapes, two mechanisms, one timer:

```
retry        reads gl_posting_attempt for rows not terminal and under the attempt bound
             → covers: role unmapped, transient DB error, anything that threw

reconcile    reads the SOURCES over a bounded recent window, minus those with an entry,
             minus those with a terminal row
             → covers: the process died before the listener ran, so no row exists at all
```

Reconciliation is bounded to a recent window rather than all history, so the backstop stays a cheap
periodic query instead of a growing scan. The window has to exceed the longest plausible outage; a
configurable default of a small number of days is right, and anything older is a bookkeeping
question for a human, not a job for a sweeper.

Reconciliation does not post directly — it inserts `PENDING` rows and lets the retry path do the
work, so there is exactly one code path that attempts a posting and one place that counts attempts.

### D4 — `createEntry` asserts the balance for all four paths

Today `postForPayment` and `postForStockTxn` compute `Σ debit` and `Σ credit` and throw on a
mismatch; `postAccrualForApproval` and the claim-settlement path are balanced by construction and
check nothing. Balanced-by-construction is true right now and is exactly the property a later edit
breaks — the accrual path is the one the AP work is about to change.

`createEntry(tem, { company, instant, sourceType, sourceId, memo, lines })` becomes the only thing
that persists a `journal_entry`:

1. assert `Σ debit = Σ credit`, throw naming the source when they differ
2. resolve `entry_date` via the company-day rule
3. persist the header and its lines

`Balanced Entry Invariant` says the system "MUST reject an entry whose sides differ by any minor
unit before it is persisted". After this it is one function that can be pointed at.

The two existing ad-hoc checks are removed rather than left in place: a duplicated assertion invites
the reader to believe the two might differ.

### D5 — `FAILED` is terminal for retrying, not for owing — and recovery must be explicit

`attempts` increments on every failed attempt; at the bound the row becomes `FAILED` and the sweep
stops retrying it, exactly as `successor-outbox` bounds its own. An unmapped role will not fix
itself, and re-attempting it every minute forever produces noise rather than a posting.

A `FAILED` row is **not** removed from the undelivered read — it is the most important thing on it.
The asymmetry is deliberate: terminal for the retry loop, not terminal for the debt.

That asymmetry forces a decision this design initially got wrong. If nothing can move a row off
`FAILED`, then an operator who reads the list, sees "`VAT_INPUT` unmapped", and maps the account has
**no way to finish** — the posting is unpostable forever and the change delivers visibility without
recovery, which is half a feature. Two ways out:

| option | verdict |
|---|---|
| reconciliation resets `FAILED` → `PENDING` while the source is still owed | rejected: the bound becomes decorative, and a permanently broken source loops 5-attempts-and-reset until it ages out of the window |
| an explicit re-queue by an operator | **chosen** |

So a `GL_POST_RETRY`-gated operation re-queues a `FAILED` row: status back to `PENDING`, `attempts`
reset, `last_error` retained so the history of what went wrong is not erased. The next sweep picks
it up through the ordinary retry path — the operation queues work, it does not post inline, so there
stays exactly one code path that attempts a posting.

The permission is a new code rather than `GL_VIEW`, because re-queuing writes; and rather than
reusing an accounting-admin code, because the people who watch this list are not necessarily the
people who edit the chart of accounts. `GlPermissions` is picked up automatically by
`allPermissionCodes()` in the seed, so a new code needs no separate registration.

## Risks / Trade-offs

**The query and the service can still disagree.** D2 removes the biggest source of drift by making
the service record its own skips, but reconciliation still has to enumerate what a *source* is
(settled payments, completed accruing documents, valued stock rows). If a fifth posting path is
added and its sources are not enumerated, they are simply never reconciled — a silent gap, not a
false alarm. The spec therefore states the enumeration as part of the requirement, so adding a path
without extending it is visibly incomplete.

**A row per posting.** One row per source, forever, on a table that only ever grows. At this
system's volume that is negligible; if it ever is not, terminal rows older than a closed period are
deletable without losing anything the journal does not already hold.

**Swallowing stays.** This change does not make a posting failure louder to the user who caused it —
the payment still succeeds and says nothing. That is intentional and unchanged: the operator who
needs to know is the one reading the undelivered-postings list, not the clerk recording a payment.

## Migration Plan

One migration creating `gl_posting_attempt` with its unique index on
`(company_id, source_type, source_id)`. No backfill: entries posted before this ships need no row
(the journal proves them), and sources that failed before it are found by the first reconciliation
pass, which is precisely the mechanism being built.

## Open Questions

- The attempt bound and the sweep interval: `successor-outbox` uses 5 attempts and a 60-second
  interval, and matching it is the default assumption unless the GL's failure modes argue otherwise.
- The reconciliation window length. It must exceed the longest plausible outage; the exact number is
  an operations decision, not a design one.
