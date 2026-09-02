## 1. Schema and entity

- [x] 1.1 Migration adds `budget_txn.txn_date` (date, not null) and an index on
      `(budget_id, txn_date)` — the shape every as-of fold reads. No backfill: nothing has launched,
      and inventing dates from `created_at` would give guesses the authority of stored data
      (design D6).
- [x] 1.2 DBML: the column, with the note that it is the day of the EVENT in the company's own
      timezone — not the insert time, which `created_at` already holds.
- [x] 1.3 `BudgetTxn.txnDate` on the entity. `createdAt` stays exactly as it is (design D3).

## 2. Stamping it, once

- [x] 2.1 `BudgetLedgerService.insertTxn` takes a REQUIRED `txnDate`. Required, not defaulted:
      a default of "today" is right for four callers and silently wrong for the fifth (design D1).
- [x] 2.2 The date is `localDateIn(instant, company.timezone)` — the same helper and the same rule
      `journal_entry.entry_date` uses, so the two ledgers share a calendar (design D2).
- [x] 2.3 `reserve` passes the document's `submitted_at`.
- [x] 2.4 `settle` passes the settlement instant; the unused-difference `RELEASE` it may write
      carries the SAME date as its `ACTUAL` — one event must not split across a boundary.
- [x] 2.5 `releaseAll` passes the acting instant (the reject, cancel or return that called it).
- [x] 2.6 `executeTransfer` passes `budget_movement.effective_date`, falling back to the approval
      day when it is absent; the `TRANSFER_OUT` and `TRANSFER_IN` share one date.
- [x] 2.7 The `ADJUST_INCREASE` / `ADJUST_DECREASE` written by the post-action passes the same
      movement's effective day.
- [x] 2.8 No lock changes: the control-point lock rule in `BudgetLedgerService` is untouched, and
      this change writes no new rows and alters no amount.

## 3. As-of reads

- [x] 3.1 `BudgetBalanceService` folds accept an optional `asOf`, bounding on `txn_date <= asOf`,
      defaulting to today so every existing caller keeps its meaning (design D4).
- [x] 3.2 The four reads that fold the ledger take it: balance, breakdown, outstanding-reserved,
      and the ledger read itself.
- [x] 3.3 The control-point availability check does NOT take an `asOf` — a reservation is made now,
      and evaluating availability as of a past date is a way to spend money since committed.
      Write the reason where the parameter is absent (design D4).
- [x] 3.4 The ledger read returns `txn_date` alongside the existing fields.

## 4. Tests

- [x] 4.1 Every writer stamps a date: one test per row type, asserting the day comes from the event
      and not from the insert.
- [x] 4.2 A reservation submitted on the company's 31 March carries 31 March even when inserted
      after midnight UTC — the timezone case, with a company in UTC+7.
- [x] 4.3 A transfer's `TRANSFER_OUT` and `TRANSFER_IN` carry the same date.
- [x] 4.4 An `ACTUAL` and the `RELEASE` of its unused difference carry the same date.
- [x] 4.5 The breakdown as of a past day folds only the rows on or before it, and the same read with
      no `asOf` is unchanged.
- [x] 4.6 The ledger read bounded to a past day returns only rows up to it.
- [x] 4.7 Availability is still checked against today: a budget whose only reservation is dated
      today cannot be over-committed by asking as of yesterday — assert the check has no such door.
- [x] 4.8 The balance formula is unchanged: the existing invariant-3 tests pass untouched.
- [x] 4.9 Each new test must fail with its feature removed. Check it.

## 4b. Found at archive

- [x] 4b.1 `reporting`'s `Budget Movement Audit Trail Report` said each row shows "timestamp" and is
      "filterable by date range" — unambiguous when `budget_txn` had one time and ambiguous now that
      it has two. MODIFIED to order and filter by `txn_date` (the day the movement happened, matching
      what the GL does with `entry_date`) and to show BOTH times, because an audit report is exactly
      where the gap between them is worth seeing.
- [x] 4b.2 The report's query orders and filters by `txn_date`, with `created_at` as the tie-break,
      and returns both fields.
- [x] 4b.3 A transfer effective on 1 May and approved on 20 May is listed when the first half of May
      is filtered.

## 5. Checks

- [x] 5.1 `npm test` in `back/`, `nest build`, frontend `test` + `typecheck`; `PIPESTATUS`.
      back: 1544 passed (+11 from this change, and 13 fixture files taught to state a date), 1 failed
      — `attendance-period.service.spec.ts`, the pre-existing time bomb pinning `2026-07-15` against
      a 30-day correction window. Attendance is untouched here. `nest build` clean; front-end 807
      tests and `vue-tsc` clean.
- [x] 5.2 The migration adds one column and one index — nothing else (`Migration20260830000000`
      has exactly those two statements); the DBML carries the same column.
- [x] 5.3 `openspec validate --all` passes — 74 passed, 0 failed.
- [x] 5.4 Do NOT edit `openspec/specs/**` by hand. The 15 changed files there are the five prior
      archive syncs, untouched by this change.
