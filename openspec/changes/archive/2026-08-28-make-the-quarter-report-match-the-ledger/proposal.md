## Why

The quarterly report and the budget's own page disagree about how much money a budget has. Budget
1.106 (ADM, FY2026) was raised to 12,000,000, then adjusted by +65,004,000, +37,000,000, +1,000,000
and −3,000,000 through four approved documents. Its detail page reports 112,004,000 — the balance
CORE INVARIANT 3 defines. The quarterly report reports 12,000,000, because
`budget-period-reporting` states the annual figure as `budget.amount_total` and that column is
never touched by an adjustment. Every share, every remainder and the overspent flag on that screen
is computed against a ceiling that stopped being true the moment the first adjustment was approved.

The same screen also shows four empty quarters for a budget the customer's workbook says consumed
112,004,000 across the year, because that expenditure has never been loaded. That half is NOT in
this change: loading it turned out to depend on an unsettled question — the plan workbook names its
departments by plan code (`1`, `3`, `7`), and the importers create departments from those codes, so
importing anything today would raise a second `ພະແນກບໍລິຫານ` beside the real `ADM`. Fixing the
ceiling is worth having on its own and does not wait for that. What it leaves is a report that is
honest about the money and still shows four zeros for a budget nothing has been spent against in
this system.

## What Changes

- The quarterly read derives each row's annual budget from the budget ledger — `amount_total`
  plus `ADJUST_INCREASE` and `TRANSFER_IN`, minus `ADJUST_DECREASE` and `TRANSFER_OUT` — instead of
  reading the `amount_total` column. Consumption stays `Σ RESERVE − Σ RELEASE`; only the figure it
  is measured against moves.
- Quarter shares, the year share, the remaining amount, the remaining share and the overspent flag
  are all computed against that derived figure, at both the budget-line and the department level, so
  the two levels cannot disagree with each other or with the budget's own page.
- **BREAKING** for any reader of the quarterly read: `amountTotal` on a row now carries the derived
  balance, not the raw column. A budget that has been adjusted returns a different number than it
  did before for the same fiscal year.
- The screen labels the figure as the budget as it now stands, so a reader who knows the original
  plan is not left thinking the report has the wrong number.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `budget-period-reporting`: the annual budget a quarter is measured against, and the remaining
  amount a row reports, change from `budget.amount_total` to the ledger-derived balance. Affects
  "A Quarter Reports Its Share Of The Annual Budget", "Every Row Reports What The Year Consumed And
  What Remains", "A Budget Of Zero Is Reported As Overspent, Never As Unused" and the screen
  requirement that names these columns.

## Impact

- **Capabilities touched**: `budget-period-reporting` (read model + screen). `budget-control` is
  read from, not changed — its balance definition becomes the single source both screens use.
- **Invariant risk**: this change exists to stop CORE INVARIANT 3 being contradicted by a report.
  The risk it introduces is the mirror image — a second, separately-written balance formula that
  drifts from `BudgetBalanceService`. Answered by taking the direction of every transaction type
  from the one shared classification both readers use, and by a test asserting the two agree for a
  budget carrying every movement type. See `design.md` for why calling the balance service directly
  was tried and rejected.
- **Append-only ledger (INVARIANT 2)**: untouched. This change adds no writes at all.
- **Code**: `back/src/modules/reporting/budget-quarter.service.ts` (the scan already loads
  `BudgetTxn` — the adjustment and transfer types are in the rows it discards), a new
  `budget-quarter-ledger-figure.spec.ts`, and the annual column's label in the three locale files
  behind the front-end quarterly report.
- **Data**: none. This change writes nothing and reads no differently — the same rows, added up
  the way invariant 3 already defines. Loading FY2026 expenditure is deferred to its own change,
  behind the department-code question above.
