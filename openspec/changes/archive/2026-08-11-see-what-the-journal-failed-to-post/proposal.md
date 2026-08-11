## Why

When the general ledger fails to post, the entire remedy is a log line.

```ts
// gl-posting.listener.ts — three times, once per event
try { await this.posting.postForPayment(e.documentId); }
catch (err) { this.logger.error(`GL posting failed for document ${e.documentId}: …`); }
```

`Config-Driven System Account Roles` states the contract plainly: an unmapped role makes the
posting "a logged failure, not a crash", and the payment, stock, or approval flow is unaffected.
That half is right — a chart-of-accounts problem must never roll back an approval six people
granted. The other half was never built. Nobody can ask the system **which postings are owed and
missing**. A company that forgets to map `VAT_INPUT` posts no VAT-bearing payment at all, and the
only evidence is a line in a log file that has already scrolled.

There is a worse case the log does not even reach. The listener runs in-process off an event
emitted *after* the business transaction commits. If the process is restarted in that window — a
deploy, a crash — nothing runs, nothing throws, and nothing is logged. The payment is committed,
the journal entry never exists, and there is no record anywhere that it should.

This is the blocker for everything downstream. Closing an accounting period safely means knowing
the period is **drained** — that no posting is still owed for a day inside it. A close built on top
of "we think it all posted" moves the problem rather than solving it. The same question gates the
AP work: a payable raised at approval and a payment that silently failed to clear it leaves a
liability on the balance sheet that no report can explain.

Two smaller things sit in the same place and are worth fixing with it. Four blocks in
`gl-posting.service.ts` construct a `journal_entry` and its lines by hand — and only two of the
four assert that debits equal credits before persisting. `Balanced Entry Invariant` says the system
"MUST reject an entry whose sides differ by any minor unit before it is persisted"; today two paths
are balanced only by construction, which is an argument, not a check.

## What Changes

- **One door for every entry.** A `createEntry` helper takes the company, the posting instant, the
  source key, a memo and the draft lines, and is the only thing that writes a `journal_entry`. It
  asserts `Σ debit = Σ credit` before persisting — so the balanced invariant is enforced once
  rather than in two of four places — and resolves `entry_date` through the company-day rule
  already in place. All four posting paths go through it.
- **A posting is recorded, not just attempted.** A new `gl_posting_attempt` table carries one row
  per `(company, source_type, source_id)` — the same key `journal_entry` is already unique on —
  with a `status` of `PENDING` / `POSTED` / `SKIPPED` / `FAILED`, an `attempts` count and a
  `last_error`. Every posting attempt writes its outcome there.
- **`SKIPPED` is a real outcome, not a silence.** Several sources legitimately post nothing: a
  settlement with no `budget_txn` ACTUAL, an accruing document that cut no budget, a `RESERVE` or
  `RELEASE` stock row, an intra-company transfer. Today those log a warning that reads exactly like
  a failure. Recording them terminally is also what keeps the sweep honest — see design D2.
- **A sweep retries and a timer backstops it.** Rows that are `PENDING` or retriable are drained on
  an interval, claimed with `PESSIMISTIC_WRITE` + `SKIP LOCKED`, with `attempts` bounded before the
  row becomes `FAILED` and stops being retried — the shape `successor-outbox` already proves. The
  same timer reconciles sources that were never attempted at all, closing the crash window above.
- **The GL can be asked what it owes.** A read-only, `GL_VIEW`-gated, company-scoped query returns
  the postings that are owed and undelivered, each with its source, its attempt count and its last
  error. This is the query a period close will run before it lets a period be closed. A `FAILED` row
  stays on it — the bound stops the retrying, not the debt.
- **An operator can finish what the sweep gave up on.** A `GL_POST_RETRY`-gated operation re-queues a
  `FAILED` row so the next sweep attempts it again. Without it the attempt bound would make a failed
  posting unpostable forever: someone reads the list, maps the missing account, and has no way to
  complete the posting (design D5).

Deliberately **out of scope**, stated so the omissions are choices:

- **Reversing entries.** The original plan for this slice included them. There is no caller: nothing
  in this system cancels a document once it is `COMPLETED` — `cancel` exists only for delegations —
  so an accrual can never be stranded by a cancellation today. A reversal built now would be a
  feature whose only test is a test of itself. Its first real consumer is the period-close accrual
  reversal, and it belongs in that change, where its shape is decided by a caller that exists.
- **A period guard inside `createEntry`.** The seam is created here on purpose — every entry passes
  one point — but there are no accounting periods to guard against yet. The guard arrives with them.
- **Bulk re-queue.** Re-queuing is one row at a time. A company that mapped a role wrong for a month
  will have a list to work through, and doing that in a loop from a screen is fine until it is not.
- **A frontend screen.** The read is exposed; presenting it belongs with the period-close UI that
  will consume it.

## Capabilities

### New Capabilities

None. Posting durability and visibility are `gl-journal`'s own business — it already owns the
posting engine, the idempotency key and the "logged failure, not a crash" contract this change
completes.

### Modified Capabilities

- `gl-journal`: a new requirement makes every entry pass one balanced-and-dated constructor; a new
  requirement records each posting attempt's outcome and makes an undelivered posting queryable; a
  new requirement bounds retries and backstops missed events; `Config-Driven System Account Roles`
  keeps its "logged failure" wording but the failure is now recorded as well as logged.

## Impact

**Backend**

- `back/src/modules/gl/gl-posting.service.ts` — `createEntry` added; the four entry constructions
  (payment settlement, approval accrual, claim settlement, stock movement) call it. The two ad-hoc
  balance checks are removed in favour of the one inside it. Each entry point records its outcome.
- `back/src/modules/gl/gl-posting.entities.ts` (new) — `GlPostingAttempt`.
- `back/src/modules/gl/gl-posting.sweeper.ts` (new) — `@Interval` sweeper modelled on
  `back/src/modules/approval/successor-sweeper.scheduler.ts`.
- `back/src/modules/gl/gl-posting.listener.ts` — the three handlers keep swallowing, and now the
  swallowed failure lands on a row instead of only in the log.
- `back/src/modules/gl/journal.controller.ts` / `journal.service.ts` — the undelivered-postings read,
  `GL_VIEW`-gated and company-scoped, and the `GL_POST_RETRY`-gated re-queue.
- `back/src/modules/gl/permissions.ts` — `GL_POST_RETRY` alongside `GL_VIEW`. `allPermissionCodes()`
  in `back/src/seed/seed-data.ts` already reads `GlPermissions`, so the code is seeded with no
  further registration.
- `erp_approval_system.dbml` — new `gl_posting_attempt` table, unique on
  `(company_id, source_type, source_id)`, plus a status enum note. It is a **work record, not a
  ledger**: rows move status in place, so it does not join `budget_txn` / `approval_log` /
  `journal_entry` in `LedgerGuardSubscriber` — the same reasoning `pending_successor` carries.
- A migration creating the table. No backfill: sources that failed before this ships are found by
  the reconciliation query, not by a data migration.

**Invariants**

- Invariant 2 (append-only ledgers) is untouched. `gl_posting_attempt` is a queue-like work record
  whose rows are updated in place, exactly like `pending_successor`; the journal it tracks stays
  append-only, and `journal_entry` remains the authority on whether a posting happened.
- Invariant 1 (company isolation): every row carries `company_id` and the read is company-scoped.
- Invariant 6 is respected: no posting path writes `budget_txn`, and none starts doing so here.

**Risk**

The reconciliation query must agree with the posting service about what "owed" means, or it reports
the same false positives forever. That is the one place this change can go quietly wrong, and it is
why `SKIPPED` is recorded terminally rather than inferred (design D2): the service decides once,
the row remembers, and the query only ever asks "no entry, and no terminal row".
