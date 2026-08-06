## 1. Backend query contract

- [x] 1.1 Add `ListEmployeesQueryDto extends PaginationQueryDto` in `back/src/modules/rbac/dto/employee.dto.ts` with optional `search` (`@IsString`, `@MaxLength(100)`), `departmentId` (`@IsUUID`), `status` (`@IsIn(EMPLOYEE_STATUSES)` from `@erp/shared`), `jobLevel` (`@IsString`), and `hasAccount` (`@Transform` `'true'`/`'false'` → boolean, `@IsBoolean`) — every field `@IsOptional()`
- [x] 1.2 Change `EmployeeController.list()` in `employee.controller.ts` to take `@Query() q: ListEmployeesQueryDto`; leave the `EMPLOYEE_MANAGE` guard and route order unchanged
- [x] 1.3 No entity or migration work — this change adds no table, column, or index

## 2. Backend service

- [x] 2.1 Widen `EmployeeService.list()` to accept the new query type, building `where` starting unconditionally with `{ company: companyId }`
- [x] 2.2 Add the search predicate: trim the term, treat empty/whitespace as absent, and add `$or` over `empCode` / `fullName` / `position` with `$ilike: '%term%'` (mirror `listLinkableAccounts()`)
- [x] 2.3 Add the AND filters: `department` by id, `status`, `jobLevel`, and `hasAccount` → `{ user: { $ne: null } }` / `{ user: null }`
- [x] 2.4 Confirm `findAndCount` returns the filtered `total` and that `orderBy: { empCode: 'ASC' }`, the department-name map, and the `EMP_SALARY_VIEW` masking in `toView()` are untouched

## 3. Backend tests

- [x] 3.1 `employee.spec.ts`: search matches `emp_code`, `full_name`, and `position`; is case-insensitive; a blank/whitespace term returns the unfiltered list
- [x] 3.2 `employee.spec.ts`: each filter alone — department, status, job level, has-account both ways — and search combined with a filter
- [x] 3.3 `employee.spec.ts`: `total` counts the filtered set, not the whole registry, when matches fit within one page
- [x] 3.4 `employee.spec.ts`: two companies holding a name-matching employee each — searching returns only the active company's row (company isolation under filtering)
- [x] 3.5 `employee.spec.ts`: a caller without `EMP_SALARY_VIEW` gets no `salary` on filtered results, and `salary` is not searchable
- [x] 3.6 `employee.controller.spec.ts`: an out-of-range `status` and a non-UUID `departmentId` are rejected (400), not silently ignored
- [x] 3.7 `employee.spec.ts`: a list with only `page`/`limit` returns exactly what it did before (no behavior change for existing callers)

## 4. Frontend API and store

- [x] 4.1 In `front-end/src/api/employees.ts`, add an `EmployeeListFilters` interface mirroring `ListEmployeesQueryDto` field for field, and change `list(page, limit, filters?)` to send the filters as query params — keeping `page`/`limit` positional so existing call sites compile
- [x] 4.2 In `front-end/src/stores/employeeAdmin.ts`, add `filters: EmployeeListFilters` to state and pass `this.filters` from `load()`, following the `documents` store pattern
- [x] 4.3 Add `applyFilters(filters)` and `clearFilters()` actions that set state and reload from page 1
- [x] 4.4 Verify `run()`'s post-mutation `this.load()` now preserves filters (this is what keeps edit/link/resign from dropping the user's filter)
- [x] 4.5 Reset `filters` when the active company changes — no code needed: `AppTopbar.onSwitchCompany` does a full `window.location.assign('/')`, which drops every Pinia store. Covered by a test asserting a fresh store starts with `{}`

## 5. Frontend screen

- [x] 5.1 In `EmployeeAdminView.vue`, remove the `FilterMatchMode` import, the `filters` ref, and the `:filters` / `:globalFilterFields` props on `AppDataTable` — the dead client-side wiring
- [x] 5.2 Wire `PageToolbar`'s search to a local ref debounced at 350 ms (matching `MyDocumentsView`) that calls `employees.applyFilters(...)`
- [x] 5.3 Add department, status, job-level, and has-account Selects in the `#filters` slot, sourced from the existing `departments` ref, `EMPLOYEE_STATUSES`, and the `jobLevels` store's `selectable` — with `showClear`, theme tokens only, no hardcoded colors
- [x] 5.4 Add a clear-filters action that resets the search term and every Select via `employees.clearFilters()`
- [x] 5.5 Confirm the existing `EmptyState` renders when a search matches nothing, and that `ErrorState` is not shown for an empty result
- [x] 5.6 Add i18n keys for the new filter labels and the clear action in every supported locale (Lao, English, Chinese)

## 6. Frontend tests and verification

- [x] 6.1 `stores/employeeAdmin.spec.ts`: `applyFilters` reloads from page 1; paging preserves filters; a post-mutation reload preserves filters; `clearFilters` empties them; a company switch resets them
- [x] 6.2 Ran: backend `rbac` suite (127 pass), `nest build`, frontend `vue-tsc -b`, and the 5 affected frontend specs (102 pass). Lint: the repo is not prettier-clean (untouched specs carry the same drift; `employee.spec.ts` had 418 prettier errors before this change), so `--fix` was not run repo-wide — only the lines added to `employee.dto.ts` / `employee.service.ts` were made prettier-clean
- [ ] 6.3 Manually verify on the employee-admin screen in dark mode: search finds an employee on a later page, each filter narrows the list, the paginator total tracks the filtered set, and clear restores the full list
