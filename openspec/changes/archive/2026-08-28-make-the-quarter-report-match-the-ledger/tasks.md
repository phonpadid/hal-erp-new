## 1. Read model — the ledger figure

No entity or migration work: nothing on disk changes shape, and `budget_txn` stays append-only.

- [x] 1.1 Import `budgetTxnDirection` from `@erp/shared` into `BudgetQuarterService` — no new
      provider and no module edit, because the direction is a shared function, not a service.
- [x] 1.2 Fold every ledger row into a per-budget balance inside the pass that already runs, seeded
      with `amount_total`: `ADDS` adds, `SUBTRACTS` subtracts, `CONVERTS` moves nothing. Fold before
      the quarter attribution — an adjustment belongs to the budget, not to a quarter.
- [x] 1.3 Derive each row's annual budget as that balance plus what the year consumed, and delete
      the `b.amountTotal` read that fed `figureFor`.
- [x] 1.4 Confirm the department roll-up sums its lines' derived figures — it sums the rows'
      `amountTotal`, so it follows 1.3 with no separate edit.
- [x] 1.5 Point every quarter share, the year share, the remaining share and the `overspent` flag at
      the derived figure, at both line and department level.
- [x] 1.6 Keep `Money` arithmetic throughout — these are DECIMAL strings, and no step here may pass
      through a JS number.
- [x] 1.7 The existing suite still passes, the five-query test included — the fold rides the scan
      that was already running and adds no read.

## 2. Tests for the read

Their own file, `budget-quarter-ledger-figure.spec.ts`, with its own ledger: the existing spec
builds one fixture all 41 of its tests read, and adding movement types to it would move numbers
those tests assert for reasons unrelated to them.

- [x] 2.1 An adjusted budget (12,000,000 with +65,004,000, +37,000,000, +1,000,000, −3,000,000)
      reports an annual budget of 112,004,000.
- [x] 2.2 Consumption neither raises nor lowers the ceiling: 100,000,000 with 40,000,000 reserved
      and 10,000,000 released reports 100,000,000 annual and 30,000,000 consumed.
- [x] 2.3 A transfer lowers the source row's ceiling and raises the destination's by the same amount
      in the same fiscal year.
- [x] 2.4 A budget whose `amount_total` is zero but carries an `ADJUST_INCREASE` of 20,000,000,
      consumed against by 5,000,000, reports a 25% year share and is NOT overspent.
- [x] 2.5 An adjustment moves the quarter denominator: 100,000,000 consumed 50,000,000 in Q1, then
      +100,000,000 adjusted, reports Q1 at 25%.
- [x] 2.6 Exactly spent is not overspent, and `annual − consumed` lands on `remaining` to the kip.
- [x] 2.7 The agreement test: a budget carrying an adjustment each way, a transfer each way, a
      reserve, a release and an `ACTUAL` reports a `remaining` equal to
      `BudgetBalanceService.availableBalance` for the same budget.
- [x] 2.8 A department's annual budget, remainder and consumption equal the sums of its lines'.
- [x] 2.9 A `budget_txn` dated outside every quarter window: counted in the ceiling, not in
      consumption — pinned rather than left undefined.
- [x] 2.10 The existing `budget-quarter.spec.ts` still passes unchanged, all 41.

## 3. Screen

- [x] 3.1 Rename the annual budget column to the budget as it now stands, in all three locales:
      `ງົບປະມານປັດຈຸບັນ` / `Budget as it stands` / `现行预算`.
- [x] 3.2 Confirm the summary tiles and the overspent filter follow — both read `overspent` and
      `yearConsumed` off the response rows, which now derive from the ledger, so neither needed an
      edit. The 34 view tests still pass.
- [x] 3.3 Verified in the running app: the quarterly report and the budget detail page both state
      112,004,000 for budget 1.106 (ADM, FY2026).

## 4. Load FY2026 recorded expenditure

Moved out of this change. Investigation while implementing found that both importers create a
`department` per PLAN code (`1`, `3`, `7` …) and match existing ones by `dept_code` only, so any run
today raises a second `ພະແນກບໍລິຫານ` beside `ADM` and a duplicate of every other department. Three
plan roots also map onto one real department (`WH`), which no edit of the workbook can express — the
code column takes digits only, and children carry their root's number. That needs a mapping the
importers do not have, which is its own change.

## 5. Close out

- [x] 5.1 `pnpm --filter back test` and `pnpm --filter front-end ci` both green — 2065 backend
      tests passed (36 skipped, all pre-existing dev-verify skips), 1042 front-end tests passed.
- [x] 5.2 Delta spec re-read against what was built. One correction was needed and was made to the
      SPEC, not the code: it required the figure to come from `BudgetBalanceService`, which
      implementation showed would scan `budget_txn` a second time. It now requires the shared
      `budgetTxnDirection` classification and forbids the second scan, with a test asserting the
      two reads agree. `design.md` records the reversal and why.
