## Why

Nothing stops a journal entry landing in a month that has already been reported.

`financial-reports` ranges every statement over `journal_entry.entry_date`, and any date is
writable at any time. A payment recorded late, a posting re-queued after a fix, an accrual whose
document was approved weeks ago — each can put a figure into a month whose income statement was
printed, sent, and acted on. `fiscal_year` has an `OPEN` / `CLOSED` status, but it guards a
different thing: `document-engine` refuses to *submit* a budget-consuming document dated in a closed
year. It says nothing about what the GL may write, and it is annual, so it cannot answer "is July
finished?".

`financial-reports` states the consequence in its own Purpose: *"Because there is no period-close
yet, the balance sheet derives retained earnings as the cumulative net income to date."* Every
statement is a live query over a ledger that can still change underneath it.

**The hard part is not the lock.** Posting runs post-commit, off an event, in its own transaction —
by design, so a chart-of-accounts problem can never roll back an approval six people granted. That
means at the moment a period is closed there may be work already committed whose entry has not been
written yet. Refusing those entries afterwards would lose them; accepting them would make the close
meaningless.

```
business txn commits ──► event ──► posting ──► entry_date
   (durable)                                        │
                                    close(July) ────┘  ← an entry still on its way to July
```

So a close cannot simply be a flag. It has to establish that the period is **drained** first — and
until now there was no way to ask. That question is exactly what
`see-what-the-journal-failed-to-post` made answerable: the undelivered-postings read already
returns what the ledger owes and has not delivered, over a date range, for precisely this caller.
The two pieces were built in this order on purpose.

## What Changes

- **An accounting period is a declared date range**, in a new `accounting_period` table: company,
  fiscal year, code, `period_start`, `period_end`, `OPEN` / `CLOSED`. Explicit dates rather than a
  year+month, for the reason the DBML already records at `attendance_period`: a company whose books
  do not run on calendar months cannot express itself otherwise, and `quota_entitlement` keying on
  year is the lesson. Two periods of one company may not overlap; gaps are allowed.
- **Closing is guarded by a readiness check.** A period cannot close while a posting it covers is
  still owed — the undelivered-postings read is asked first, and a close is refused with the list.
  This is the whole design: drain, then lock, rather than lock and hope.
- **Closing is ordered.** A period cannot close while an earlier one is open, and cannot be
  reopened while a later one is closed. Otherwise the cumulative figures every statement is built
  from stop meaning anything.
- **`createEntry` refuses a closed day.** The seam left for this in
  `post-the-journal-on-the-companys-own-day` and widened in `see-what-the-journal-failed-to-post` is
  where the guard goes: every entry resolves its `entry_date` at one point, so "is that day open?"
  is asked once. A refused posting is not lost — it becomes a recorded, queryable, re-queueable
  failure, which is machinery that already exists.
- **A company that declares no period is unaffected.** No periods means nothing is closed and
  nothing is blocked, exactly as `attendance-period` behaves. This is what makes the change safe to
  ship before anyone is ready to use it.
- **Reopening is permitted, audited, and separately permissioned.** `PERIOD_CLOSE` and
  `PERIOD_REOPEN` are distinct codes, a reason is required to reopen, and every close and reopen is
  an append-only `accounting_period_log` row — the shape `attendance_period_log` already proves,
  down to sitting in `LedgerGuardSubscriber`.

Deliberately **out of scope**:

- **Closing entries and retained earnings.** A monthly close here is a *soft* close: it freezes the
  period, it does not roll revenue and expense into equity. `financial-reports` keeps deriving
  retained earnings as cumulative net income, which is correct for a system with no year-end close.
  The hard close belongs with the fiscal year, and with the manual journal entry it needs.
- **Accrued-expense and FX-revaluation journals at close.** Both are period-close *postings*, and
  both need a way to write a journal that no event produced — which this system does not have. They
  are the next slice, not this one; naming them here is what stops "the period closed" being
  mistaken for "the period is complete".
- **Guarding business actions by period.** Recording a payment dated inside a closed month still
  succeeds; its posting is what refuses, visibly. Refusing at the endpoint is better UX and belongs
  in the capabilities that own those endpoints — they consume this guard rather than reimplement
  it.
- **A frontend.** The reads are exposed; the screen belongs with the close workflow it drives.

## Capabilities

### New Capabilities

- `accounting-period`: declaring periods, closing and reopening them, the audit log, and the guard
  other capabilities ask. It is its own capability rather than part of `gl-journal` because a period
  is not a journal concern — the GL is its first consumer, and the accrual postings, the tax
  summaries and the financial statements will each be another.

### Modified Capabilities

- `gl-journal`: `Every Entry Is Written Through One Balanced Constructor` gains the period check,
  which is the reason that requirement exists in the shape it does.

## Impact

**Backend**

- `erp_approval_system.dbml` — `accounting_period` and `accounting_period_log`, modelled on
  `attendance_period` / `attendance_period_log` including their notes about why the range is
  explicit.
- `back/src/modules/accounting/period/` (new) — entities, service (declare / close / reopen /
  readiness), guard, controller.
- `back/src/common/ledger/ledger-guard.subscriber.ts` — `AccountingPeriodLog` joins `APPEND_ONLY`
  beside `AttendancePeriodLog`; the period itself does not, being a row whose status changes.
- `back/src/modules/gl/gl-posting.service.ts` — `createEntry` consults the guard. It becomes async,
  which every caller already is.
- `back/src/modules/accounting/permissions.ts` — `PERIOD_VIEW`, `PERIOD_MANAGE`, `PERIOD_CLOSE`,
  `PERIOD_REOPEN`, picked up by `allPermissionCodes()` with no further registration.
- One migration for the two tables.

**Invariants**

- Invariant 1: both tables carry `company_id`, and every read and write is company-scoped.
- Invariant 2: the log is append-only and enforced by the subscriber; the period row is not a ledger
  and changes status in place, exactly as `pending_successor` and `gl_posting_attempt` do.
- Invariant 3 and 6: closing writes no `budget_txn` and touches no budget. The budget and the ledger
  are separate books, and this closes one of them.

**Risk**

The readiness check is the load-bearing part and the place this can be wrong in both directions. Too
strict and no period ever closes, because something is always owed; too loose and the close is
decorative. It asks exactly one question — *are there undelivered postings whose date falls in this
period* — and the answer is only as good as `SKIPPED` being recorded terminally, which
`see-what-the-journal-failed-to-post` established and which its own tests pin.

Second: `createEntry` becoming async ripples to four call sites. They are all already inside
`async` transactional callbacks, so the change is mechanical — but it is the function every entry in
the system passes through, and a missed `await` there would silently drop a posting rather than
failing.
