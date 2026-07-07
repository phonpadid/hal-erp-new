## 1. Budget reads: fork when no transactional em

- [x] 1.1 `BudgetBalanceService`: change `availableBalance`, `outstandingReserved`, `breakdown`, `usageLedger` from `em: EntityManager = this.em` to `em?: EntityManager` + `const m = em ?? this.em.fork();` and use `m` (breakdown passes `m` into `requireInActiveCompany`).
- [x] 1.2 `BudgetService`: `list()` → `this.em.fork().find(...)`; `get()` → `this.em.fork().findOne(...)`.

## 2. Quota reads: same fork pattern

- [x] 2.1 `QuotaBalanceService`: change `netUsage`, `outstandingUsage`, `entitlementTotal`, `remaining`, `breakdown`, `usageLedger` to `em?: EntityManager` + `const m = em ?? this.em.fork();`.
- [x] 2.2 Verify `QuotaService.list/get` already read via `CompanyScopeService.forActiveCompany()` (a fork); leave unchanged if so.

## 3. Regression test

- [x] 3.1 DB-backed (reuse `seedDatabase`): construct `BudgetBalanceService`/`QuotaBalanceService` with the ROOT `orm.em`; inside `RequestContext.run({ companyId })` (no MikroORM context, no `em` arg) call `budget.breakdown(id)`, `budget.usageLedger(id)`, `quota.breakdown(id)` → all return without throwing the global-context error. Also call one with an explicit forked `em` and assert it still works (transactional branch).

## 4. Verify

- [x] 4.1 `pnpm --filter back build` + `pnpm --filter back test` pass.
- [x] 4.2 Manual: a fresh backend instance returns HTTP 200 for `GET /budgets/:id/breakdown` against `new_erp`.
- [x] 4.3 Run `openspec validate fix-budget-quota-read-context --type change --strict`.
