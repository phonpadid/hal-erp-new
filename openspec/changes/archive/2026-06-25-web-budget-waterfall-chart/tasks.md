<!-- Frontend-only, read-only change: no MikroORM entities, no migration, no service,
     no controller, and no budget_txn/quota_usage writes — so the backend/entity/
     concurrency task rules do not apply. The waterfall reuses the existing budget
     breakdown payload and adds no endpoint. -->

## 1. Chart component

- [x] 1.1 Add a `BudgetWaterfallChart.vue` under `front-end/src/views/budgets/` taking the breakdown object and `currencyDecimals` as props.
- [x] 1.2 Build the ordered step list from the breakdown in the exact derivation order: `amountTotal` (start), `+adjustIncrease`, `−adjustDecrease`, `+transferIn`, `−transferOut`, `−reserved`, `−actual`, `+released`, reusing the same order/signs as `BudgetDetailView.vue`'s `rows`.
- [x] 1.3 Compute the running balance and emit one floating `[prevRunning, newRunning]` bar per step; ground the first bar `[0, amountTotal]` and a final `available` bar `[0, available]`.
- [x] 1.4 Parse DECIMAL strings to Number only for bar geometry; never bind money as a JS number for display and add nothing new to the wire.

## 2. Rendering & theming

- [x] 2.1 Render with PrimeVue 4 `Chart` (Chart.js bar type) configured for floating/range bars.
- [x] 2.2 Color increase steps, decrease steps, and the final available bar from PrimeUI theme tokens (no hardcoded hex); re-resolve tokens on `.dark` toggle so light/dark both render.
- [x] 2.3 Format axis ticks and tooltips with `formatAmount(value, currencyDecimals)` so amounts honor the currency `decimal_places`.

## 3. Integration

- [x] 3.1 Mount `BudgetWaterfallChart` in `BudgetDetailView.vue` inside a `SectionCard`, alongside (not replacing) the existing numeric breakdown, behind the page's `BUDGET_VIEW` gating.
- [x] 3.2 Pass `budgets.breakdown` and `currencyDecimals`; render nothing when the breakdown is not loaded.
- [x] 3.3 Add i18n keys for the chart title ("งบเดินทางมายังไง" / "How the budget travelled"), the running-balance/available labels, and the increase/decrease legend.

## 4. Tests

- [x] 4.1 Unit test: the waterfall step builder's final running total equals `available` for representative figures (e.g. total 1,000,000 / reserved 100,000 / released 40,000 → 940,000).
- [x] 4.2 Unit test: amounts are formatted to the currency `decimal_places` (0-decimal currency renders 0 fraction digits) and no value is a JS number on the wire.
- [x] 4.3 Component test: the chart is not rendered without `BUDGET_VIEW`.
