## Why

`budget_node` was built for this file. It has not yet met it.

The customer's 2026 expenditure plan is one sheet of a monitoring workbook in `data/budget/`:
554 rows, 20 departments, **413,619,804,355 LAK**, in use — the same workbook records 5,715 spend
entries against it. The system holds three budgets, all of them invented by me while testing.

Measured against the file rather than assumed:

| | |
|---|---|
| plan rows | 554 (553 codes; `3.1` appears twice with different content) |
| departments | 20 — the system has **2** |
| rows carrying a 2026 amount | 313 |
| …of those, money with nothing beneath them | **241** |
| what those 241 become once the unbudgeted half is zeroed and the conflicts withheld | **394,685,630,508** |
| …exact summaries of what lies beneath | 51 → structure, no money of their own |
| …stating an amount that conflicts with what lies beneath | **21** |
| budgeted departments reconciling to the kip | **5 of 13** |

The last two rows are the reason this change is worth designing rather than scripting. The
remaining 0.7% — 2,917,005,848 LAK — is not rounding; it is 21 places where the spreadsheet says
two different things and only a person can say which is meant.

## What Changes

- A **CLI importer**, `pnpm import:budget-plan`, reusing the workbook reader built for the chart
  of accounts. Same posture: operator-run, `--company` required, `--dry-run` first.
- **Departments are created from the plan's own roots** — 20 of them, from codes `1`–`20`. Without
  them there is nothing for a budget to belong to.
- **The plan's unbudgeted half is imported at zero.** The sheet's own totals divide it: departments
  1–13 are `ລວມ ຍອດ ມີງົບ` (397,602,636,355) and departments 14–20 are `ລວມ ຍອດ ບໍ່ມີງົບ`
  (16,017,168,000) — money not budgeted. The latter get their structure and a budget of `0`, so
  nothing can be spent against them and the 8,729,095,321 LAK they have already incurred still has
  somewhere to land.
- The plan's structure becomes `budget_node` rows; **money becomes `budget` rows only where the
  file puts money with nothing beneath it**. A row whose amount equals the money beneath it is
  structure, and creating a budget for it as well would double that money inside any control point
  governing the subtree.
- A row whose amount **conflicts** with the money beneath it is imported as structure, its own
  amount is NOT created, and it is **named in the report** with both figures. 21 rows, and the
  importer refuses to guess between them.
- Budgets are created and **put in force through the existing plan/activation path**, one plan
  document per department, so the control points that govern them are minted the way every other
  budget's are. An import that wrote `ACTIVE` rows directly would leave all 241 ungoverned.
- **BREAKING (fix)**: `BudgetPlanService.activate` refuses a budget with no `account`. That guard
  is stale — the same method now scopes its control point to `budget.node`, and `CreateBudgetDto`
  has made `gl_account` optional. Every line of the customer's plan names an account nowhere, so
  today not one of them could be activated. The guard goes.

## Capabilities

### New Capabilities
- `budget-plan-import`: taking an existing expenditure plan into a company from the customer's own
  workbook — creating the departments it names, separating the plan's structure from its money,
  refusing to guess where the file contradicts itself, and putting the result in force through the
  ordinary approval path.

### Modified Capabilities
- `budget-control`: activation stops requiring a resolved GL account, because the control point it
  mints is scoped to the budget's node and a budget may legitimately name no account.

## Impact

- **New**: `back/src/modules/budget/plan-import/` (reader adapter, tree + money classification,
  writer), a `back/package.json` script. The workbook reader from `chart-import` is reused as-is.
- **Changed**: `BudgetPlanService.activate` loses the account guard. `Department` rows are created
  by an importer for the first time.
- **Invariants**: this writes `budget` and `budget_control_point` rows through the existing
  activation path, so the append-only ledger (2), the derived-balance formula (3) and the
  reserve→actual lifecycle (4) are untouched — no `budget_txn` row is written by this change.
  Company isolation (1) is carried the same way the chart import carries it: the company is named
  on the command line and stamped on every row.
- **Out of scope, deliberately**: the 5,715-row spend history — the next change, and it depends on
  this one, because an opening document needs a budget to charge. **When that change is written,
  read `see-spending-by-quarter` first**: the direction agreed here was one opening document per
  budget, and a later decision to show spending by quarter makes that wrong. A document carries one
  date, so 334 documents put the whole 221,259,490,412 LAK into a single quarter. One document per
  budget per month is 1,197, and every spend row already carries a day. Monthly and quarterly phasing
  (the file carries both) and the revenue plan sheet stay excluded, as they were when `budget_node`
  was designed. Prior-year columns (2024/2025, populated on 21 rows) are not imported.
