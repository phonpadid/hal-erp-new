## Context

Two period concepts already exist in this system, and neither can close a month's books.

```
fiscal_year          OPEN / CLOSED, annual
                     guards document SUBMIT (document-engine), not GL WRITE
                     cannot answer "is July finished?"

attendance_period    DRAFT / CLOSED, explicit date range, no overlap, append-only log,
                     close and reopen on separate permissions
                     — the shape this change copies, for a different ledger
```

The GL has no period at all. `financial-reports` ranges every statement over
`journal_entry.entry_date`, and every date is writable at any moment.

What makes this harder than a flag is the posting architecture, which is deliberate and not going
to change: postings run **post-commit**, off an event, in their own transaction, so a
chart-of-accounts fault can never roll back an approval. The consequence is a window in which work
is committed and its entry is not yet written.

The last two changes are what make a close possible now:

| built | why it matters here |
|---|---|
| `see-what-the-journal-failed-to-post` | "what does the ledger still owe, in this date range?" is a query |
| `post-the-journal-on-the-companys-own-day` | every entry resolves its day at one point, in the company's zone |

## Goals / Non-Goals

**Goals:**

- A closed month reports the same figures whenever it is read.
- Closing establishes that the month is drained rather than assuming it.
- A refused posting is visible and recoverable, not lost.
- A company that has not declared a period is entirely unaffected.

**Non-Goals:**

- Closing entries, retained earnings, year-end. A monthly close here is a soft close.
- Accrued-expense and FX-revaluation journals at close. They need a way to post a journal no event
  produced; that does not exist yet.
- Guarding business endpoints by period. They will consume this guard; reimplementing it in each is
  how the two drift.

## Decisions

### D1 — Drain, then lock

```
close(2026-08)
  ① earlier periods closed?              no  → refuse
  ② anything still owed for this range?  yes → refuse, WITH the list
  ③ status = CLOSED, log the actor
```

Step ② is the design. A close that merely sets a flag would leave whatever was in flight to be
refused afterwards, which loses entries the business already committed — the one outcome worse than
not closing at all.

**Revised during implementation: step ② asks about the whole company, not about the period's date
range.** The first version passed `{ from: period_start, to: period_end }`, and a test caught that
it does not work: `undelivered` bounds `last_attempt_at`, the moment a posting was *tried*, not the
day its entry would carry — so a posting that failed today for a November document is invisible when
November is closed, and the close passes with work still owed.

The fix is not a better date filter, because there is no date to filter on. **An undelivered posting
has no entry, and therefore no date in the books**; which month it lands in is knowable only once it
is delivered. Bounding the question would mean re-deriving that date from the source, outside
`createEntry` — duplicating the one decision `createEntry` exists to make. So the check is strict:
anything owed anywhere blocks every close. Its escape hatch — deliver it, re-queue it, or resolve
why it cannot post — is the behaviour we want regardless.

The alternative was to accept late entries into a closed period and post them to the next open one
(the roll-forward many systems use). Rejected: it silently moves a figure to a month it did not
happen in, and the reason it is tempting — that nothing is lost — is already provided here by the
posting queue, which holds a refused entry visibly until a person decides.

Step ① is not decoration. Every statement is cumulative; a July closed after August means August's
comparatives were computed over a July that could still move.

### D2 — The guard sits at `createEntry`, and refusal is an ordinary posting failure

`createEntry` is already the single point every entry passes through, asserting the balance and
resolving the company day. The comment left there in
`post-the-journal-on-the-companys-own-day` said this guard would sit beside it; it does.

A refused posting throws, which the posting service already turns into a `FAILED`
`gl_posting_attempt` row carrying the message, visible on the undelivered read and re-queueable by
an operator once the period is reopened or the situation resolved. **No new failure machinery is
needed**, and that is the strongest argument for having built the queue first: a period guard
without it would have been a way to silently drop entries.

The bounded retry is right here too. A posting refused because a month is closed will be refused
identically on every retry, so parking it in `FAILED` after the bound — visible, not retried — is
exactly the desired behaviour rather than a compromise.

### D3 — No declared period blocks nothing

The guard resolves the period covering an entry's date. Three outcomes:

```
period is OPEN        → post
period is CLOSED      → refuse
no period covers it   → post
```

The third is what makes this shippable. A company that has declared nothing is in exactly its
current state, and `attendance-period` already establishes the precedent — *"A period that was never
declared blocks nothing"* — so the behaviour is consistent across the two ledgers rather than a
special case someone has to learn twice.

It also means adoption is per company and reversible: declare August, close it, and everything
before August stays writable.

### D4 — Reopening is allowed, ordered, audited, and separately permissioned

A close is not a promise the figures were right; it is a statement that they were final at a moment.
Sometimes they were wrong. Refusing to reopen makes the correction happen somewhere worse — a
back-dated entry into the next period, or a spreadsheet.

- reopening requires `PERIOD_REOPEN`, a **different** code from `PERIOD_CLOSE`
  (`attendance-period` separates these for the same reason);
- a reason is required and stored;
- every close and reopen is an append-only `accounting_period_log` row — the file where "who
  reopened July, and why" is answered;
- a period cannot be reopened while a later one is closed, mirroring D1's ordering. Reopening July
  under a closed August would let July move while August's comparatives were already fixed.

### D5 — The period is a row that changes; the log is a ledger that does not

`accounting_period.status` moves OPEN → CLOSED → OPEN. That is the point of it, so it is
deliberately **not** in `LedgerGuardSubscriber` — the same reasoning `budget_control_point`
(configuration), `pending_successor` and `gl_posting_attempt` (work records) already carry there.

`accounting_period_log` **is** in it, beside `attendance_period_log`. The status is the current
answer; the log is the history, and a history that can be edited answers nothing.

### D6 — One period per date, per company

Two periods covering one date would give "is this day closed?" more than one answer, so overlap is
rejected at declaration. Gaps are allowed: a company that never declared July simply has no July to
close, and by D3 July stays writable.

Both rules are `attendance_period`'s, and the DBML note there explains the range-not-month choice at
length. Copying the shape means one mental model for two ledgers instead of two.

## Risks / Trade-offs

**The readiness check can be wrong in both directions.** Too strict and nothing ever closes because
something is always owed; too loose and the close is decorative. It rests entirely on `SKIPPED`
being recorded terminally — the decision from `see-what-the-journal-failed-to-post` D2 — because
otherwise every legitimately-nothing-to-post source would look like outstanding work forever. That
dependency is worth naming: this change is only as sound as that one.

**`createEntry` becomes async.** It is the function every entry in the system passes through. All
four call sites are already inside `async` transactional callbacks so the change is mechanical, but
a missed `await` there would drop a posting silently rather than failing — the one edit in this
change that deserves to be read twice.

**A closed period plus a late business action is a worse experience than it should be.** The payment
is recorded, its posting is refused, and someone finds out from the undelivered list rather than at
the point of entry. That is deliberate scope, not an oversight: guarding the endpoints belongs to
the capabilities that own them. Until they do, the close is enforced but not explained at the moment
it bites.

**Nothing here computes what a close ought to compute.** No accruals, no revaluation, no closing
entries. A month can be closed and still be incomplete in the accounting sense. The proposal says
so; anyone reading only the code might not.

## Migration Plan

One migration creating both tables. No backfill and no default period: every company starts with
none declared, which by D3 is exactly today's behaviour.

## Open Questions

- Whether the readiness check should consider only `FAILED` rows or also `PENDING` ones. `PENDING`
  is the honest answer — work still owed is still owed — but a company with a stuck source could
  find it cannot close at all. The escape is re-queueing or resolving that source, which is the
  behaviour we want; it is listed here because it will be someone's first complaint.
