## 1. Module scaffolding & DTOs

- [x] 1.1 Create `MultiCompanyModule` registering the 4 entities via `MikroOrmModule.forFeature([Company, Department, FiscalYear, HolidayCalendar])`; provide `CompanyScopeService`; import it in `AppModule`.
- [x] 1.2 Add class-validator DTOs under `modules/multi-company/dto/`: create/update for department, fiscal year, and holiday; reuse `companyCreateSchema` from `@erp/shared` (+ `ZodValidationPipe`) for company create, and a class-validator update-company DTO.
- [x] 1.3 Add permission-code constants (`COMPANY_VIEW`, `COMPANY_MANAGE`, `DEPARTMENT_VIEW`, `DEPARTMENT_MANAGE`, `FISCAL_YEAR_MANAGE`, `HOLIDAY_MANAGE`) in a module `permissions.ts`.

## 2. Company management (entities exist → service → controller)

- [x] 2.1 `CompanyService`: create/update/list/get/deactivate. Create & update validate `base_currency` references an **active** `currency` row (reject otherwise). Deactivate sets `is_active = false` (never delete). List excludes inactive unless `includeInactive`.
- [x] 2.2 `CompanyController`: REST endpoints guarded by `@RequirePermissions` (`COMPANY_MANAGE` writes, `COMPANY_VIEW` reads); `ParseUUIDPipe` on `:id`; `JwtAuthGuard` + `PermissionsGuard` applied.

## 3. Department tree

- [x] 3.1 `DepartmentService` (uses `CompanyScopeService.forActiveCompany()`): create/update/list/get/deactivate. On set `parentDept`, reject a parent in a different company and reject any parent that would create a cycle (walk `parent_dept_id` ancestors with a visited-set).
- [x] 3.2 `DepartmentController`: company-scoped REST guarded by `DEPARTMENT_MANAGE`/`DEPARTMENT_VIEW`; `ParseUUIDPipe` on id params.

## 4. Fiscal years & closed-period guard

- [x] 4.1 `FiscalYearService` (company-scoped): create/update/list/get and `close(id)` (OPEN→CLOSED; reject if already CLOSED). Add `assertOpenPeriod(date, companyId?)` that finds the active company's fiscal year covering `date` and throws a closed-period error if none or CLOSED.
- [x] 4.2 `FiscalYearController`: REST guarded by `FISCAL_YEAR_MANAGE`; a `POST :id/close` endpoint; `ParseUUIDPipe` on id.

## 5. Holiday calendar & working-time SLA helper

- [x] 5.1 `HolidayCalendarService` (company-scoped): create/list/get/delete holidays.
- [x] 5.2 `WorkingTimeService.addWorkingHours(start, hours, companyId)`: advance by N working hours, skipping weekends and dates in `holiday_calendar` for that company (load holidays into a `Set`).
- [x] 5.3 `HolidayCalendarController`: REST guarded by `HOLIDAY_MANAGE`; `ParseUUIDPipe` on id.

## 6. Tests (business rules + scope)

- [x] 6.1 Department rules: rejects a cross-company parent; rejects a reparent that creates a cycle; accepts a valid same-company nesting.
- [x] 6.2 Fiscal year: `close` flips OPEN→CLOSED and rejects a second close; `assertOpenPeriod` passes for an OPEN-covering date and throws for a CLOSED year / no covering year.
- [x] 6.3 Company: deactivate sets `is_active = false` and the row still exists; create rejects an inactive/unknown `base_currency`; default list omits inactive.
- [x] 6.4 Company scope: a request with active company A lists only A's departments; a write targeting company B is rejected.
- [x] 6.5 `WorkingTimeService`: adding working hours across a weekend and a seeded company holiday excludes those non-working days.

## 7. Verify

- [x] 7.1 `pnpm --filter back build` and `pnpm --filter back test` pass.
- [x] 7.2 Run `openspec validate implement-multi-company --strict`.
