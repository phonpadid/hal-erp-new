## 1. Schema and status

- [x] 1.1 `budget.status` accepts `CLOSED` alongside `DRAFT` / `ACTIVE` / `REJECTED`. No column
      change and no migration data: nothing has launched, so no year is closed yet (design D6).
- [x] 1.2 DBML: the new status on `budget`, with the note that it is an appropriation that ran its
      year — readable as a record, not drawable as a pot, and distinct from `REJECTED`.

## 2. The refusal (close step ②)

- [x] 2.1 When the period being closed is its fiscal year's last, refuse while any document in a
      non-terminal state still holds an un-released reserve against that year's budgets —
      `Σ RESERVE − Σ RELEASE − Σ ACTUAL > 0` per document per budget, the same reading the balance
      uses (design D2).
- [x] 2.2 The refusal names them, capped and counted like the undelivered-postings refusal, and
      says the remedy: complete or cancel.
- [x] 2.3 It sits with ② in `AccountingPeriodService.close`, before the accrual and the revaluation,
      so a refused close has written nothing.
- [x] 2.4 A period that is NOT the year's last is not checked — a mid-year close has no business
      asking about the year's commitments.

## 3. The act (close step ④)

- [x] 3.1 `closeYearIfFinalPeriod` sets every budget of that fiscal year to `CLOSED`, in the same
      transaction that posts the closing entry and flips `fiscal_year.status`.
- [x] 3.2 `amount_total` and every `budget_txn` row are left exactly as they are — the appropriation
      stands as a record (design D3).
- [x] 3.3 Idempotent with the rest of ④: a retried close finds the budgets already `CLOSED` and
      changes nothing.

## 4. The guard

- [x] 4.1 `BudgetLedgerService.insertTxn` refuses a row against a `CLOSED` budget, naming the budget
      and its fiscal year. One point, so a writer added later inherits it (design D4).
- [x] 4.2 The refusal is loud — an exception the caller sees — not a silently dropped row.

## 5. Reopening

- [x] 5.1 Reopening a period that is its fiscal year's last returns `fiscal_year.status` to `OPEN`
      and that year's budgets to `ACTIVE`, in the reopen's own transaction (design D5).
- [x] 5.2 Note in the code that `YearCloseService.closeYear` is idempotent by
      `(sourceType, sourceId)`, so a re-close keeps the ORIGINAL closing entry rather than
      recomputing it — a pre-existing GL defect this change surfaces and deliberately does not fix.

## 6. Tests

- [x] 6.1 A year with a document holding a reservation refuses the close, names it, and leaves the
      period `OPEN` — nothing accrued, nothing revalued, no closing entry.
- [x] 6.2 Cancelling that document unblocks the same close.
- [x] 6.3 A mid-year period closes with such a document outstanding.
- [x] 6.4 Closing the year sets its budgets `CLOSED` and leaves `amount_total` and the ledger rows
      untouched.
- [x] 6.5 A `RESERVE`, an `ACTUAL` and a `TRANSFER` against a closed year's budget are each refused,
      naming the budget — and nothing is written.
- [x] 6.6 A closed year's budgets are not offered by the selectable-budgets read. The read already
      filters `status = 'ACTIVE'` (`budget-control`: *Selectable Budgets for Document Creation*), so
      a `CLOSED` budget drops out with no code change — and `budget-read.spec.ts` already pins that
      the read returns only `ACTIVE` rows, which is the assertion that would catch it being widened.
- [x] 6.7 Reopening the final period returns the year to `OPEN` and its budgets to `ACTIVE`, and a
      reservation against them succeeds again.
- [x] 6.8 A retried close changes nothing the first one did.
- [x] 6.9 Each new test must fail with its feature removed. Check it.

## 6b. Found at archive

- [x] 6b.1 `web-budgets` explained why a non-`ACTIVE` budget is not a coverage fault by enumerating
      the statuses and giving ONE reason — "`DRAFT` and `REJECTED` … coverage is established at
      activation" — which does not cover `CLOSED`: that one HAD coverage and no longer needs it.
      MODIFIED to give each status its own reason and to require the grouping be driven by the
      status value rather than a known list.
- [x] 6b.2 The UI already behaves correctly (the store buckets every non-`ACTIVE` status generically
      and the locales already carry a `CLOSED` label), so only the reasoning was too narrow. The
      comments in `stores/budgets.ts` and `BudgetListView.vue` were widened to match.
- [x] 6b.3 Two store tests: a `CLOSED` budget goes to its own bucket rather than the fault bucket,
      and an unknown status is bucketed by value. Hardcoding `DRAFT`/`REJECTED` fails both.

## 7. Checks

- [x] 7.1 `npm test` in `back/`, `nest build`, frontend `test` + `typecheck`; `PIPESTATUS`.
      back: 1551 passed (+7 from this change), 1 failed — `attendance-period.service.spec.ts`, the
      pre-existing time bomb pinning `2026-07-15` against a 30-day correction window. Attendance is
      untouched here. `nest build` clean; front-end 807 tests and `vue-tsc` clean.
- [x] 7.2 No migration at all: `budget.status` is a varchar that accepts the new value, and nothing
      has launched so no year is closed yet. The DBML documents the four statuses.
- [x] 7.3 `openspec validate --all` passes.
- [x] 7.4 Do NOT edit `openspec/specs/**` by hand. The changed files there are the six prior archive
      syncs, untouched by this change.
