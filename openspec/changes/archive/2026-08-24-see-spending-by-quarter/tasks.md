## 0. Before starting — read this

> This change is a READ. It cannot be judged useful until the spend history is in the ledger, and
> the history import does not exist yet. Two consequences:
>
> - Every DB-backed test here builds its own ledger rows. None of them depend on the import.
> - **Do not start the history import from the direction recorded in `import-budget-plan`.** It says
>   one opening document per budget; this change makes that wrong. The note at the end of design.md
>   carries the replacement and the measurements behind it.

- [x] 0.1 Read design.md end to end, in particular the nine decisions. Each one has an alternative
      that was rejected for a measured reason; re-deriving them costs an hour and re-litigating them
      costs more.

## 1. Attributing a ledger row to a quarter

- [x] 1.1 `budget/budget-period.ts`: given a fiscal year and a date, return the quarter index 1–4.
      Take the fiscal year's `start_date`, not the calendar year — a company whose year starts in
      April has a Q1 that is not January.
- [x] 1.2 Resolve the quarter of a `RESERVE` for a `(document_id, budget_id)` pair. Exactly one
      exists per pair (`budget-ledger.service.ts` sums a document's lines per budget), so this is a
      lookup, not an aggregate.
- [x] 1.3 Attribute every ledger row: `RESERVE` and `ACTUAL` by their own `txn_date`; **`RELEASE` by
      the quarter of the reserve it gives back**. Adjustments and transfers by their own date.
- [x] 1.4 Unit tests: a release in Q3 against a Q2 reserve lands in Q2; a reserve and release in the
      same quarter net correctly; no quarter can go negative; a fiscal year starting in April maps
      April to Q1.

## 2. The read

- [x] 2.1 `reporting/budget-quarter.service.ts`: for a fiscal year, return per department and per
      budget the four quarters' consumption (`Σ RESERVE − Σ RELEASE`, attributed per task 1).
- [x] 2.2 One scan of the ledger grouped by quarter, not four queries. The obvious implementation is
      a loop over quarters and this report runs over every document the company will ever raise.
- [x] 2.3 Company scope through the budget's fiscal year (invariant 1). A test asserts another
      company's budgets contribute nothing.
- [x] 2.4 Test the reconciliation that keeps this honest: the four quarters sum to what the annual
      `budgetUtilization` reports as consumed, for every department. If they ever diverge, one of
      the two is wrong and this test says so.

## 3. Comparing with the previous quarter

- [x] 3.1 Each quarter carries its change against the one before it — absolute and, where both sides
      are non-zero, proportional.
- [x] 3.2 Resolve the elapsed portion of an unfinished quarter against the COMPANY's day, reusing
      the company-day resolution the ledger service already has rather than `new Date()`.
- [x] 3.3 When the current quarter is unfinished, compare against the same number of elapsed days of
      the previous quarter, not the whole of it.
- [x] 3.4 Test with the customer's own shape: a quarter 40 days into 92 consuming 33,688,204,885
      against a previous quarter that consumed 33,723,386,829 in its first 40 days and
      90,365,434,887 in total — the comparison reports −0.1%, not −63%.
- [x] 3.5 Label rather than score when a side is missing: started, stopped, or no earlier quarter.
      Test all three, and test that none of them emits a percentage.
- [x] 3.6 A finished quarter compares whole. Test that the elapsed-window logic does not follow it
      into a closed quarter.

## 4. Zero budgets

- [x] 4.1 Where the view expresses consumption as a proportion, a zero budget reports none — the
      rule `budgetUtilization` now follows. Reuse it rather than restating it.
- [x] 4.2 A zero budget consumed against is marked overspent by the amount consumed; a zero budget
      untouched is not marked at all. Test both.

## 5. Route and screen

- [x] 5.1 Controller route under `/reports`, guarded by the same permission code as the other budget
      reports. Test the guard the way the other report routes are tested.
- [x] 5.2 Frontend: quarterly view grouped by department, expandable to budget lines — the
      `TreeTable` pattern the departments screen uses and the grouped/tree/flat control the budgets
      list already offers.
- [x] 5.3 The unfinished quarter is visibly distinct from the finished ones and states how much of
      it has elapsed. (Added while testing: a department also carries a warning when a line BENEATH
      it has overspent. Without it the screen repeats the customer's own blind spot — every one of
      their departments reads positive while 31,632,169,758 LAK of overspending sits in the lines
      underneath, and nobody expands twenty rows to find it.)
- [x] 5.4 A comparison that cannot be made reads in words. Never `−100%`, never `∞`, never an empty
      cell — a blank reads as "still loading".
- [x] 5.5 Amounts formatted from strings with the company's base-currency decimal places. Test with
      LAK (0 decimals), because every figure in this customer's data is LAK and a hardcoded 2 would
      be wrong on every screen.
- [x] 5.6 i18n keys in en / la / zh.

## 6. Verification

- [x] 6.1 Backend (1,871) and frontend (925) suites green; `vue-tsc` clean; `tsconfig.build.json` clean.
- [x] 6.2 **Mutation-check the release attribution**: attribute a release by its own `txn_date` and
      confirm 1.4 fails. This is the decision most likely to be "simplified" later by someone who
      does not know it was chosen, and it is invisible — the year still totals correctly while every
      quarter is wrong.
- [x] 6.3 **Mutation-check the elapsed window**: compare an unfinished quarter whole and confirm 3.4
      fails. A report that says spending collapsed 63% because the calendar has not caught up will
      be believed once and never again.
- [x] 6.4 Drive it in the running app against `erp_uitest`. Two defects only the screen showed:
      a quarter the year has NOT REACHED read "stopped" — arithmetically right, and the opposite of
      true — and it advertised "0 of 92 days" as though it were in progress. Fixing the first
      exposed the real one: the department roll-up carried its OWN copy of the labelling rule, so
      the same column read "not started" on a budget row and "stopped" on the department above it.
      One `compare()` now decides both, with a test that pins them together.
- [x] 6.5 Sync the spec into `openspec/specs/` and archive.

## 7. Record before closing

- [x] 7.1 Note whether the quarterly figures were ever wanted outside the company. **Not asked
      again since the budget department said "internal use only".** Recorded here because the
      release attribution is the single piece that has to change if that answer ever does: a
      figure that leaves the building cannot move after it has been sent, and the alternative —
      attributing a release to its own date — is written up in design.md with what it costs.
- [x] 7.2 Note whether `Σ ACTUAL` was wanted as a second column. **Not built, not asked.** Nobody
      can want it yet: for the imported 2026 history the two measures are identical to the kip, so
      the gap between them only appears once documents are raised in the system. Revisit after the
      first quarter of live use, not before.

- [x] 7.3 Record what driving the app found, because no test would have: a quarter the calendar has
      not reached was labelled "stopped" and advertised "0 of 92 days". The label was duplicated
      between the per-budget figure and the department roll-up, so the same column disagreed with
      itself on one screen. Two places computing one rule is the defect worth remembering — the
      spec now has a scenario pinning the two levels together.
