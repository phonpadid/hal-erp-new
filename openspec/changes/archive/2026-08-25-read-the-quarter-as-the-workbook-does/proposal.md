## Why

The budget department reads its year off one sheet, `ສາລະບານງົບປະມານ`, and that sheet answers three
questions the quarterly screen cannot: which MONTH inside a quarter the money went out, what share
of the annual budget each quarter took, and what is left of the year. The screen reports four
quarter totals and a change against the previous quarter — true, and not what the department is
looking at when it opens the workbook.

The workbook's own figures are now in the system: 1,187 imported documents carrying
221,259,490,412 LAK of 2026 spending, reconciled department by department against the sheet — 16 of
its 19 departments agree to the kip. What is missing is the reading, not the data.

Driving the screen after the import also showed a line that says the wrong thing: a budget that has
never been spent against reports every quarter after the first as `ຢຸດໃຊ້` — stopped — because a
comparison of zero against zero falls into the branch that means "it used to run and no longer
does". Nothing started, so nothing stopped.

## What Changes

- The quarterly read reports, for each quarter, the **three monthly figures inside it**, so the
  month a cost landed in is visible without expanding a document list.
- Each quarter reports its **share of the annual budget** (`quarter consumed ÷ amount_total`),
  following the rule already in force: a budget of zero has no share at all, and reports overspent.
- Each row reports its **year figures**: consumed for the year, what is left of the annual budget,
  and the remaining share. The year-used share already exists and keeps its meaning.
- A quarter that **never started is labelled as such, not as stopped**. Zero against zero currently
  falls through to `STOPPED` and asserts a spending pattern that never existed.
- The screen shows the new figures: the monthly split behind a per-quarter disclosure so the
  default view stays readable, the quarter share under each quarter total, and the year columns at
  the right. Department rows carry the same figures as the lines beneath them, from the same rule.
- **NOT** taken from the workbook: its `ໄຕມາດ` column (annual ÷ 4) and its `ສ່ວນຕ່າງ ໄຕມາດ` column
  (that quarter target minus what was used). The existing quarter-against-quarter comparison stays
  as the only comparison. The customer's two sheets compute that variance differently and reach
  opposite verdicts on the same department — `ພະແນກ ບໍລິຫານ` Q1 reads 203,877,015 over in one and
  12,008,768,161 under in the other — and 21 of 293 lines set the quarterly figure by hand, so a
  quarterly ceiling would mean inventing 964 figures nobody has written down.

## Capabilities

### New Capabilities

None. This extends a read and a screen that both already exist.

### Modified Capabilities

- `budget-period-reporting`: the quarterly read gains monthly figures within each quarter, a
  per-quarter share of the annual budget, and the year's consumed/remaining/remaining-share; the
  "labelled, not scored" requirement gains the case it currently gets wrong — a quarter with nothing
  on either side has not stopped; and the screen requirement, which lives in this same capability,
  gains the new figures. `web-dashboards` is NOT modified: it carries the cross-cutting reporting
  rules (money formatting, theme tokens, filters) that this change follows rather than changes.

## Impact

- `back/src/modules/reporting/budget-quarter.service.ts` — `QuarterFigure`, `BudgetQuarterRow` and
  `BudgetQuarterDepartment` gain fields; `compare()` gains the never-started case; `figureFor()` and
  `rollUp()` carry the new figures. One pass over the ledger is preserved: the monthly split is
  bucketed in the loop that already reads every row, not by a second query per month.
- `back/src/modules/reporting/budget-quarter.spec.ts` — new rules pinned, including the zero-against-
  zero label that no test covers today.
- `front-end/src/api/reports.ts`, `front-end/src/views/reports/BudgetQuarterReport.vue` and its spec.
- `front-end/src/i18n/locales/{en,la,zh}/reports.ts` — the new column and month labels in all three.
- No migration. No new column on `budget_txn` (invariant 2: the ledger stays append-only and
  unaltered); every figure is derived from `txn_date`, which each row already carries.
- No change to reserving, releasing or governing budget. This is a read.
- Invariant 3 is untouched: consumption stays `Σ RESERVE − Σ RELEASE`, `ACTUAL` is not subtracted,
  and the four quarters continue to sum to the annual figure — the monthly figures sum to their
  quarter by the same rule.
- Invariant 1 is untouched: the read is scoped to the active company through the budget's fiscal
  year, as it is today.
