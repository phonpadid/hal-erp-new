## 1. Ledger attribution — months

No entity or migration: this change adds no column to `budget_txn` and no table. The month a ledger
row belongs to is derived, next to the rule that already derives its quarter.

- [x] 1.1 In `back/src/modules/budget/budget-period.ts`, add `monthsOf(startDate)` returning the
      twelve fiscal-month windows, and `attributeMonths(startDate, txns)` mapping each transaction to
      its 1-based fiscal month — a `RELEASE` to the month of the `RESERVE` it gives back, mirroring
      `attributeQuarters` and reusing the same `(document_id, budget_id)` lookup rather than a
      second one.
- [x] 1.2 In `back/src/modules/budget/budget-period.spec.ts`, pin: a `RELEASE` lands in the reserve's
      month; the three months of a quarter sum to that quarter for arbitrary input; a fiscal year
      starting 1 April puts an April row in fiscal month 1.

## 2. The quarterly read

- [x] 2.1 In `back/src/modules/reporting/budget-quarter.service.ts`, extend `QuarterFigure` with
      `months: { month: number; consumed: string }[]` (three entries) and
      `utilizationPct: number | null`; extend `BudgetQuarterRow` and `BudgetQuarterDepartment` with
      `yearConsumed: string`, `remaining: string` and `remainingPct: number | null`.
- [x] 2.2 Bucket months inside the EXISTING single loop over `attributable`, into a
      `consumedByMonth` map keyed `${budgetId}:${fiscalMonth}`. No second query, no per-month scan.
- [x] 2.3 Extract the share rule into one function and call it from both the year figure and the new
      per-quarter share, so `yearUtilizationPct` and `utilizationPct` cannot disagree: zero
      `amount_total` yields `null`, never `0`.
- [x] 2.4 Compute `yearConsumed` (already summed from the quarters), `remaining` via `Money.subtract`
      leaving a negative remainder negative, and `remainingPct` as `100 − yearUtilizationPct` only
      where that is non-null.
- [x] 2.5 Add `NO_ACTIVITY` to `NoComparison` and the branch to `compare()`, ordered BEFORE the
      `STOPPED` branch so zero-against-zero stops falling into it. `compare()` stays the single
      place the rule lives, so departments inherit the fix.
- [x] 2.6 Carry the new fields through `rollUp()` by summing the lines and applying the SAME shared
      functions — never a second copy of the rule.

## 3. Backend tests

- [x] 3.1 In `back/src/modules/reporting/budget-quarter.spec.ts`, pin the monthly figures: a quarter
      reports its three months; the three sum to the quarter for every budget AND every department;
      a release moves to the reserve's month.
- [x] 3.2 Pin the per-quarter share: 100,000,000 of 400,000,000 reads 25%; a zero budget reports
      `null` and is marked overspent, not 0%.
- [x] 3.3 Pin the year figures: consumed, remaining, remaining share; an overspent row reports a
      NEGATIVE remainder; a zero budget reports no remaining share; a department's figures equal the
      sums of its lines'.
- [x] 3.4 Pin `NO_ACTIVITY`: a budget with nothing in either quarter reports no activity, NOT
      stopped — the case with no test today and the defect visible on screen; and a quarter the year
      has not reached still reports `NOT_STARTED`, not `NO_ACTIVITY`.
- [x] 3.5 Assert the read still issues no additional query per month or quarter (the existing
      one-pass guarantee), and that the four quarters still sum to the annual figure.

No concurrency test applies: this change reserves no budget and issues no document number. It adds
no write, so no `em.transactional()` boundary and no `LockMode.PESSIMISTIC_WRITE` are introduced.

## 4. The screen

- [x] 4.1 Mirror the new fields in `front-end/src/api/reports.ts` — `months`, `utilizationPct`,
      `yearConsumed`, `remaining`, `remainingPct`, and `NO_ACTIVITY` in the `NoComparison` union.
- [x] 4.2 In `front-end/src/views/reports/BudgetQuarterReport.vue`, render each quarter's share under
      its total in the existing stacked cell, and add the year columns (consumed, remaining,
      year share, remaining share) to the right of Q4. A row with no share shows none, never `0%`.
- [x] 4.3 Add the per-quarter month disclosure: a control on each quarter header that reveals that
      quarter's three months in place, the other three quarters staying collapsed. Months render as
      amounts only — no label, no comparison.
- [x] 4.4 Map `NO_ACTIVITY` in `changeLabel`/`changeTone`, in the muted tone the other
      non-comparisons already use.
- [x] 4.5 Add every new label to `front-end/src/i18n/locales/{en,la,zh}/reports.ts` in the same task,
      so the three languages cannot drift.
- [x] 4.6 Extend `front-end/src/views/reports/BudgetQuarterReport.spec.ts`: the months of one quarter
      reveal alone; the year columns render on departments and lines; a row with no share renders no
      percentage; `NO_ACTIVITY` renders as words, not `−100%`.

## 5. Verify against the customer's own workbook

- [x] 5.1 Open the screen against the imported 2026 data and confirm no quarter of an unspent line
      still reads `ຢຸດໃຊ້`.
- [x] 5.2 Compare the rendered figures for `ພະແນກ ບໍລິຫານ` with `ສາລະບານງົບປະມານ`: quarter totals
      `M R V Z`, the monthly cells behind them, `AA`, `AB` and `AG`. They agree for 16 of the 19
      departments; departments 18, 19 and 20 will read HIGHER than the sheet by 929,934,363 LAK in
      total, because the sheet's own group-row formulas skip charges booked directly onto group
      codes. Record the three so the next reader does not treat the system as wrong.
- [x] 5.3 Run the backend and frontend suites and the lint step before handing over.
