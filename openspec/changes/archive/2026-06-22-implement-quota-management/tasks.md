## 1. Module scaffolding & DTOs

- [x] 1.1 Create `QuotaManagementModule` (`MikroOrmModule.forFeature([Quota, QuotaUsage, QuotaEntitlement])`, provide `CompanyScopeService`); register in `AppModule`.
- [x] 1.2 Add permission-code constants `QUOTA_VIEW`, `QUOTA_MANAGE` in a module `permissions.ts`.
- [x] 1.3 Add class-validator DTOs: create/update quota (`quotaType`, `unit`, `limitValue` `@IsNumberString`, `resetCycle?`, `departmentId?`); create/update entitlement (`quotaId`, `employeeId`, `year`, `entitledValue`, `carriedOver?`, `adjusted?`); rollover DTO; a remaining query DTO (`employeeId?`, `year?`).

## 2. Quota registry & entitlements

- [x] 2.1 `QuotaService` (company-scoped via `CompanyScopeService`): create/update/list/get/deactivate quotas (deactivate sets `is_active = false`, default list omits inactive).
- [x] 2.2 `QuotaEntitlementService`: create/update entitlement (unique quota+employee+year); `rollover({ quotaId, employeeId, fromYear, toYear, entitledValue })` setting `carried_over` = prior-year remaining.
- [x] 2.3 Controllers: `QuotaController` (CRUD + `GET /quotas/:id/remaining`) and `QuotaEntitlementController` (create/update + `POST /quota-entitlements/rollover`), guarded by `QUOTA_MANAGE`/`QUOTA_VIEW`, `JwtAuthGuard` + `PermissionsGuard`, `ParseUUIDPipe` on ids.

## 3. Balance & reservation engine

- [x] 3.1 `QuotaBalanceService`: `netUsage(quotaId, employeeId?, em?)` = `Σ USE − Σ RELEASE` (filters company off); `remaining(quotaId, { employeeId?, year? }, em?)` = personal entitlement total or quota `limit_value`, minus net usage; `outstandingUsage(documentId, quotaId, employeeId?, em?)`.
- [x] 3.2 `QuotaUsageService.reserve({ documentId, quotaId, employeeId?, qty, year? })`: in one `inTransaction`, lock the quota row (and entitlement row for personal) `FOR UPDATE`, compute remaining inside the txn, reject if `qty > remaining` (over-quota), insert a USE `quota_usage`.
- [x] 3.3 `releaseAll(documentId)`: insert RELEASE rows restoring the outstanding USE per (quota[, employee]) for the document (idempotent at 0; never release more than used).

## 4. Tests (rules + concurrency)

- [x] 4.1 Personal balance: `remaining = entitled + carried_over + adjusted − net usage`; two employees with different entitlements get different balances.
- [x] 4.2 Over-quota: requesting 3 days with 2 remaining is rejected; a within-balance reserve succeeds and reduces remaining.
- [x] 4.3 Auto-release: reject/cancel inserts a RELEASE restoring the reserved quantity; net usage returns to prior.
- [x] 4.4 Concurrency: two concurrent reserves of the last remaining unit → exactly one succeeds (uses `lockForUpdate` + `inTransaction`).
- [x] 4.5 Rollover: carry-forward seeds next year's `carried_over` from the prior year's remaining.

## 5. Verify

- [x] 5.1 `pnpm --filter back build` and `pnpm --filter back test` pass.
- [x] 5.2 Run `openspec validate implement-quota-management --strict`.
