## Why

`multi-company` is the first capability in the build order — every other capability is
scoped by `company_id` and reads its department tree, fiscal years, and holidays. The
scaffold already ships the four entities (`company`, `department`, `fiscal_year`,
`holiday_calendar`) and the cross-cutting seams (company-scope filter, permission-code
guard, JWT context). This change turns that skeleton into a working capability: REST
endpoints, services that enforce the invariants, and tests — so downstream slices
(rbac, budget, documents) have real companies, departments, and calendars to build on.

## What Changes

- **Module wiring**: a `MultiCompanyModule` registering the four entities via
  `MikroOrmModule.forFeature`, with services and controllers.
- **Company management**: CRUD for `company` guarded by `COMPANY_MANAGE`; create/update
  validate that `base_currency` references an active `currency`; companies are
  deactivated (`is_active = false`), never hard-deleted. List/read guarded by
  `COMPANY_VIEW`.
- **Department tree**: CRUD for `department` (company-scoped) guarded by
  `DEPARTMENT_MANAGE`; reparenting validates the parent is in the **same company**
  (invariant 1); a department cannot be its own ancestor (no cycles).
- **Fiscal years**: CRUD for `fiscal_year` guarded by `FISCAL_YEAR_MANAGE`; a
  **close** operation flips status OPEN→CLOSED; a reusable `assertOpenPeriod(date)`
  guard rejects budget-consuming work dated inside a CLOSED year (consumed later by
  budget/document slices).
- **Holiday calendar + SLA helper**: CRUD for `holiday_calendar` guarded by
  `HOLIDAY_MANAGE`, plus a `WorkingTimeService.addWorkingHours(start, hours, companyId)`
  that skips weekends and company holidays — the basis for workflow SLA countdowns.
- **DTOs & validation**: class-validator DTOs with `ParseUUIDPipe` on UUID params; the
  company-create rule set is shared with the frontend via a Zod schema in `@erp/shared`.
- **Enforcement**: every endpoint carries a permission-code guard; company-scoped
  resources (department, fiscal_year, holiday) are filtered to the active company via
  the existing `CompanyScopeService`; cross-company access is rejected.
- **Tests**: unit/integration tests for the same-company parent rule, cycle rejection,
  closed-period guard, base-currency validation, company-scope isolation, and the
  working-day SLA calculation.

No schema change — the entities already match the DBML, so no new migration is needed.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `multi-company`: adds API-surface and enforcement requirements that the existing
  four requirements implied but did not specify — company deactivation (no hard
  delete), the fiscal-year **close** operation, department cycle prevention, and the
  rule that all multi-company endpoints authorize by permission code and apply company
  scope. The four existing requirements (Company Registry, Department Tree, Fiscal Year
  per Company, Holiday Calendar) are unchanged.

## Impact

- **Affected capability**: `multi-company` (foundational — unblocks rbac → … →
  notifications). No other capability's requirements change.
- **Invariants exercised**: 1 (company isolation — same-company parent rule, company
  scope on reads/writes), 5 (permission codes — `COMPANY_MANAGE`, `DEPARTMENT_MANAGE`,
  `FISCAL_YEAR_MANAGE`, `HOLIDAY_MANAGE`, plus `*_VIEW`). 7 (configuration over code)
  is respected by leaving document behavior out of scope.
- **Code**: new `back/src/modules/multi-company/` services, controllers, DTOs, module;
  a shared `companyCreateSchema` already exists in `@erp/shared` (extend if needed);
  unit/integration tests under the module.
- **New permission codes** introduced (seeded/enforced here, formally managed by rbac
  later): `COMPANY_VIEW`, `COMPANY_MANAGE`, `DEPARTMENT_VIEW`, `DEPARTMENT_MANAGE`,
  `FISCAL_YEAR_MANAGE`, `HOLIDAY_MANAGE`.
- **Dependencies**: none new; uses MikroORM, class-validator, existing auth/scope seams.
