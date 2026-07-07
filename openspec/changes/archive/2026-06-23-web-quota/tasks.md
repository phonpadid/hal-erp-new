## 1. Backend: breakdown + usage reads (quota-management)

- [x] 1.1 `QuotaBalanceService.breakdown(quotaId)`: pool `{ limit, used: netUsage(quotaId), remaining }` + entitlements `[{ employeeId, employeeName, year, entitled (entitledValue+carriedOver+adjusted), used: netUsage(quotaId, employeeId), remaining }]` + quota meta (type, unit, resetCycle, departmentName). Reuse `netUsage`/`entitlementTotal`.
- [x] 1.2 `QuotaBalanceService.usageLedger(quotaId)`: `quota_usage` for the quota, `orderBy createdAt DESC` → `[{ id, usageType, qtyUsed, employeeName, documentId, documentNo, createdAt }]` (batch-resolve employee/document names by id).
- [x] 1.3 `QuotaController`: `GET /quotas/:id/breakdown` and `GET /quotas/:id/usage` (both `@RequirePermissions('QUOTA_VIEW')`, `ParseUUIDPipe`), each first calling `this.quotas.get(id)` to enforce active-company scope, then delegating to the balance service.

## 2. Backend test

- [x] 2.1 DB-backed (reuse `seedDatabase`): the seeded ANNUAL_LEAVE quota's breakdown lists the requester entitlement with `entitled=12`, `used=0`, `remaining=12`; after a `quota_usage` USE of 2 against a document, the employee's `used=2`/`remaining=10` and `usageLedger` returns the row with its `documentNo`; a quota in a second company is not readable when company A is active.

## 3. Frontend data layer

- [x] 3.1 `api/quotas.ts`: `list()`, `get(id)`, `breakdown(id)`, `usage(id)` (typed; quantities as strings).
- [x] 3.2 `stores/quota.ts` (Pinia): `list`, `current`, `breakdown`, `usage`, `loading`, `error`; `loadList()` (pool remaining per row from breakdown), `loadOne(id)` (get + breakdown + usage); capture errors.
- [x] 3.3 `utils/quota.ts`: pure `deriveRemaining(entitled, used)` (decimal.js) for reconciliation/tests.

## 4. Views & shell

- [x] 4.1 `views/quota/QuotaListView.vue`: DataTable (type, unit, department, limit, remaining, reset cycle); row → `quota-detail`; empty + error states.
- [x] 4.2 `views/quota/QuotaDetailView.vue`: pool card (limit − used = remaining, formatted by unit); entitlements DataTable (employee, year, entitled, used, remaining) shown when entitlements exist; usage DataTable with `documentNo` linking to `document-detail`.
- [x] 4.3 Routing + nav: `quota` (`meta.permission='QUOTA_VIEW'`) and `quota/:id`; a "Quota" nav item gated by `can('QUOTA_VIEW')`.

## 5. Frontend tests

- [x] 5.1 Quota store (mock `api`): `loadList` populates; `loadOne` sets current + breakdown + usage; an error is captured.
- [x] 5.2 `utils/quota`: `deriveRemaining` computes entitled − used exactly (no float drift).

## 6. Verify

- [x] 6.1 `pnpm --filter back build` + `pnpm --filter back test` and `pnpm --filter front-end build` + `pnpm --filter front-end test` pass.
- [x] 6.2 Run `openspec validate web-quota --type change --strict`.
