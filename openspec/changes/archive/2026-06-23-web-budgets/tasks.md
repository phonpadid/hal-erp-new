## 1. Backend: breakdown + ledger reads (budget-control)

- [x] 1.1 `BudgetBalanceService.breakdown(budgetId, em?)`: load the budget (reject if absent), fold `budget_txn` once into `{ amountTotal, adjustIncrease, adjustDecrease, transferIn, transferOut, reserved, actual, released, available }` (strings via `Money`); `available` uses the same formula as `availableBalance`.
- [x] 1.2 `BudgetBalanceService.ledger(budgetId)`: `budget_txn` for the budget, `orderBy createdAt DESC`, populate `document` → `[{ id, txnType, amount, documentNo, remark, createdAt }]`.
- [x] 1.3 `BudgetController`: `GET /budgets/:id/breakdown` and `GET /budgets/:id/ledger` (both `@RequirePermissions('BUDGET_VIEW')`, `ParseUUIDPipe`), after `/:id/balance`.

## 2. Backend: company-scoped budget reads (invariant 1)

- [x] 2.1 `BudgetService.list()`: scope to the active company via `{ fiscalYear: { company: RequestContext.companyId() } }`.
- [x] 2.2 `BudgetService.get(id)` (and the breakdown/ledger reads): after loading, verify `budget.fiscalYear.company.id === active company` else `NotFoundException` (cross-company id ≡ missing).
- [x] 2.3 Backend test (DB-backed): reuse `seedDatabase`; breakdown of the seeded budget reconciles (available = formula); after a RESERVE txn, `reserved` reflects it and `available` drops; `ledger` returns the rows newest-first; a budget under a second company is not returned by `list` and its breakdown/ledger 404 when the first company is active.

## 3. Frontend data layer

- [x] 3.1 `api/budgets.ts`: `list()`, `get(id)`, `breakdown(id)`, `ledger(id)` (typed; amounts as strings).
- [x] 3.2 `stores/budgets.ts` (Pinia): `list`, `current`, `breakdown`, `ledger`, `loading`, `error`; `loadList` (with per-row available), `loadOne(id)` (get + breakdown + ledger); capture errors.
- [x] 3.3 `utils/money.ts`: pure `formatAmount(value, decimalPlaces)` (decimal.js `toFixed`, no JS-number math) and `deriveAvailable(breakdown)` (recompute available from components).

## 4. Views & shell

- [x] 4.1 `views/budgets/BudgetListView.vue`: DataTable (name, GL, fiscal year, department, total, available, status); row → `budget-detail`; empty + error states.
- [x] 4.2 `views/budgets/BudgetDetailView.vue`: breakdown card (total → +adjust → ±transfer → −reserved − actual + released = available, formatted by the currency's decimal places) + ledger DataTable; ledger `documentNo` links to `document-detail`.
- [x] 4.3 Routing + nav: `budgets` (`meta.permission='BUDGET_VIEW'`) and `budgets/:id`; a "Budgets" nav item gated by `can('BUDGET_VIEW')`.

## 5. Frontend tests

- [x] 5.1 Budgets store (mock `api`): `loadList` populates; `loadOne` sets current + breakdown + ledger; an error is captured.
- [x] 5.2 `utils/money`: `formatAmount` respects decimal places (e.g. JPY 0, THB 2) with no float drift; `deriveAvailable` reconciles to the breakdown's available.

## 6. Verify

- [x] 6.1 `pnpm --filter back build` + `pnpm --filter back test` and `pnpm --filter front-end build` + `pnpm --filter front-end test` pass.
- [x] 6.2 Run `openspec validate web-budgets --type change --strict`.
