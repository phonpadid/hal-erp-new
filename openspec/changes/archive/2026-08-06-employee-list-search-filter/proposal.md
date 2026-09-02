## Why

The employee-admin screen's search box does nothing. It binds PrimeVue's client-side
`filters.global` / `globalFilterFields`, but the shared `AppDataTable` runs `DataTable` in
`lazy` mode — in lazy mode PrimeVue performs no filtering, so typing produces no effect and
`GET /employees` has no `search` parameter to fall back on. With registries running to
hundreds of rows at 20 per page, an admin can only find someone by paging manually, and
there is no way at all to narrow the list by department, status, job level, or whether the
person has a login account.

This change touches **rbac** (the employee registry backend) and its web area; no budget,
quota, document, or approval capability is involved.

## What Changes

- `GET /employees` accepts a `search` term matched case-insensitively against `emp_code`,
  `full_name`, and `position`, in addition to `page` / `limit`.
- `GET /employees` accepts optional filters: `departmentId`, `status`, `jobLevel`, and
  `hasAccount` (linked / not linked to an `app_user`). Filters combine with AND; `search`
  matches any of its three fields (OR).
- `total` in the paged envelope reflects the filtered set, so the paginator is correct while
  a search or filter is active.
- A new `ListEmployeesQueryDto extends PaginationQueryDto` validates the query with
  class-validator; unknown or malformed filter values are rejected rather than ignored.
- The employee-admin screen sends search and filters to the server: the toolbar search is
  debounced, department / status / job-level / account Selects render in the existing
  `PageToolbar` `#filters` slot, a clear-filters action resets them, and changing any of
  them resets to page 1 while paging preserves them.
- The dead client-side `FilterMatchMode` wiring on `EmployeeAdminView` is removed.
- Filter state moves into the `employeeAdmin` Pinia store so it survives paging, refresh,
  and post-action reloads (edit, link, resign) rather than living only in the view.
- Not breaking: every parameter is optional, so an unparameterised `GET /employees` behaves
  exactly as today.

## Capabilities

### New Capabilities

None. This extends existing list behavior; no new capability is introduced.

### Modified Capabilities

- `employee-registry`: the registry listing requirement gains company-scoped server-side
  search and filtering, with `total` counted over the filtered set. Company isolation and
  the `EMP_SALARY_VIEW` salary gate are unchanged — filtering never widens what a caller can
  see, and `salary` is never a searchable or filterable field.
- `web-employee-admin`: the admin screen requirement gains a working search field and a
  filter bar that query the server, replacing the inert client-side filter.

## Impact

**Backend** (`back/src/modules/rbac/`)
- `dto/employee.dto.ts` — add `ListEmployeesQueryDto`.
- `employee.controller.ts` — `list()` takes the new DTO instead of `PaginationQueryDto`.
- `employee.service.ts` — `list()` builds a company-scoped `where` from search + filters.
- `employee.controller.spec.ts` / `employee.spec.ts` — cover search, each filter, the
  combination, and that cross-company rows never surface through a filter.

**Frontend** (`front-end/src/`)
- `api/employees.ts` — `list()` takes a query object.
- `stores/employeeAdmin.ts` (+ `.spec.ts`) — filter state, reset-to-page-1 semantics.
- `views/admin/EmployeeAdminView.vue` — debounced search, `#filters` slot Selects.

No schema migration, no new table or column, no dependency added. No permission code changes:
the endpoint stays behind `EMPLOYEE_MANAGE`, and salary stays behind `EMP_SALARY_VIEW`.

**Invariants**: the company scope (`{ company: companyId }`) remains the first predicate in
every query, so Invariant 1 (company isolation) holds — filters may only narrow within the
active company, never across it. No append-only ledger, budget, quota, FX, or numbering path
is touched.
