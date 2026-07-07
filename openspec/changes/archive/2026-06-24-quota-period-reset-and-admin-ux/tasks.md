## 1. Schema & Migration

- [x] 1.1 Update `erp_approval_system.dbml`: add `quota_usage.period_year` (int), `quota_usage.period_index` (smallint), `quota.carry_forward` (boolean, default true), and index `(quota_id, period_year, period_index)`.
- [x] 1.2 Update MikroORM entities in `quota.entities.ts`: add `periodYear` / `periodIndex` to `QuotaUsage`, `carryForward` to `Quota`.
- [x] 1.3 Generate a MikroORM migration adding the columns + index with safe defaults (period_year/index default 0, carry_forward default true).
- [x] 1.4 Write a data migration backfilling `period_year` / `period_index` on existing `quota_usage` from `created_at` against each quota's `reset_cycle`.

## 2. Periodized Balance Accounting

- [x] 2.1 Add a `periodForCycle(resetCycle, date)` helper returning `{ periodYear, periodIndex }` (YEARLY→1, QUARTERLY→1–4, MONTHLY→1–12, NONE→0/0).
- [x] 2.2 `quota-balance.service`: make `netUsage`, `outstandingUsage`, `remaining`, and `breakdown` accept an optional period (default current) and filter `quota_usage` by `period_year` (and `period_index` for sub-annual cycles); scope personal usage to the entitlement year.
- [x] 2.3 Unit tests: prior-period usage does not reduce the current period; MONTHLY/QUARTERLY pools reset at period boundary; personal YEARLY balance counts only the year's usage.

## 3. Reserve / Release with Period Stamping

- [x] 3.1 `quota-usage.service.reserveIn`: derive the period via `periodForCycle` from the quota's `reset_cycle` and stamp `period_year` / `period_index` on the USE row, inside the existing pessimistic-lock transaction. Compute remaining against the same period.
- [x] 3.2 `quota-usage.service.releaseAll`: partition outstanding USE by (quota, employee, period) and stamp each RELEASE with the USE's period; never UPDATE/DELETE (append-only).
- [x] 3.3 Concurrency test: two reservations for the last unit in the current period — exactly one succeeds; verify a prior-period USE does not block a new-period reserve.
- [x] 3.4 Test: reject in a later period inserts a RELEASE stamped with the original reservation's period.

## 4. Entitlement Admin Endpoints

- [x] 4.1 Add `AdjustEntitlementDto` (quotaId, employeeId, year, delta as IsNumberString, reason) and a `quota-entitlement.service.adjust` that applies a signed delta to `adjusted` under a row lock; fail if the entitlement is missing.
- [x] 4.2 Replace single-employee `rollover` with `carryForward({ quotaId, fromYear, toYear })` that, in one `em.transactional()`, seeds every source-period entitlement's remaining into the target `carried_over`; force 0 when `quota.carry_forward` is false; idempotent (overwrite, not accumulate).
- [x] 4.3 Add entitlement read(s): list `quota_entitlement` for a quota filtered by year, returning entitled total / used / remaining per employee (derived, period-scoped).
- [x] 4.4 Controller: expose `POST /quota-entitlements/adjust`, `POST /quota-entitlements/carry-forward`, and `GET` entitlements (gate `QUOTA_MANAGE` for writes, `QUOTA_VIEW` for reads); company-scoped.
- [x] 4.5 Tests: adjust changes remaining and is permission-gated; carry-forward seeds carried_over, respects the policy flag, and is idempotent; entitlement read reconciles.

## 5. Quota Definition Endpoint Updates

- [x] 5.1 Add `carryForward` to `CreateQuotaDto` / `UpdateQuotaDto` and the create/update service paths; include it in breakdown/get responses.
- [x] 5.2 Test: create/update round-trips `carry_forward` and `reset_cycle`.

## 6. Frontend — web-quota-admin

- [x] 6.1 Extend `front-end/src/api/quotas.ts` with admin calls: create/update/deactivate quota, list/upsert/adjust entitlements, carry-forward.
- [x] 6.2 Shared Zod schemas mirroring the backend DTOs (quota definition, entitlement, adjustment) for `@primevue/forms` + `zodResolver`.
- [x] 6.3 Quota admin store (Pinia) for definitions, entitlements (by year), and action state.
- [x] 6.4 `QuotaAdminListView` + create/edit form: type, unit, level (company/department), limit, reset cycle, carry-forward policy, active state.
- [x] 6.5 Entitlement management panel: per-employee entitled/used/remaining by year, set entitlement, mid-year adjust dialog (delta + reason), carry-forward action with confirmation.
- [x] 6.6 Add routes + nav entry gated by `QUOTA_VIEW` / `QUOTA_MANAGE`; format quantities by unit (decimal strings, never JS number).
- [x] 6.7 i18n keys (en + la) for the admin screens.

## 7. Verification

- [x] 7.1 Backend unit + concurrency tests pass (Vitest); `openspec validate quota-period-reset-and-admin-ux` is clean.
- [ ] 7.2 Manual/e2e check: create a MONTHLY quota, reserve via a document, confirm reset at period boundary, run carry-forward, and confirm reject/cancel auto-releases within the correct period.
