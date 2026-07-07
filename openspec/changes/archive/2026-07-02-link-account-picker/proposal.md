## Why

In the employee-admin "Link account" dialog, linking to an existing login account requires the
admin to **paste a raw `app_user` UUID** — a value no admin knows without querying the database.
The path is effectively unusable, defeating the purpose of the "link existing account" mode.

## What Changes

- Add a backend read that returns the **linkable login accounts** — `app_user` rows not already
  linked to any employee — as `{ id, username, email }`, guarded by `EMPLOYEE_MANAGE` (the same
  permission as the link/create-account actions) and supporting an optional name/email search.
  Exposed as `GET /employees/linkable-accounts`.
  - The existing `GET /rbac/users` is **not** reused: it is guarded by `RBAC_MANAGE` (an employee
    admin need not hold it), it exposes no linked/unlinked state, and it returns per-company role
    assignments the dialog does not need.
- In the "Link account" dialog's **existing** mode, replace the free-text UUID input with a
  **searchable account picker** that lists unlinked accounts by `username` (and `email`), and
  submits the chosen account's id to the unchanged `POST /employees/:id/link`.
- Add a shared `LinkableAccount` type so the client and API agree on the shape.

## Capabilities

### New Capabilities
<!-- none — this extends existing rbac and web-employee-admin capabilities -->

### Modified Capabilities
- `rbac`: add a requirement for an `EMPLOYEE_MANAGE`-guarded read of login accounts that are not yet
  linked to any employee, returning `id`, `username`, and `email` (no per-company assignment data).
- `web-employee-admin`: change the "Link an existing account" behaviour so the admin selects an
  unlinked account from a searchable picker instead of pasting an `app_user` UUID.

## Impact

- **Backend:** `back/src/modules/rbac/employee.controller.ts` (new `GET :id`-free
  `linkable-accounts` route), `employee.service.ts` (new `listLinkableAccounts(search?)` — select
  `app_user` where no `employee.user_id` references it), reusing the existing `EMPLOYEE_MANAGE`
  guard.
- **Shared:** `shared/src/index.ts` — new `LinkableAccount` type.
- **Frontend:** `front-end/src/views/admin/EmployeeAdminView.vue` (existing-mode picker),
  `stores/employeeAdmin.ts` + `api/employees.ts` (fetch linkable accounts), i18n `la`/`en`
  `admin.ts` (picker label/placeholder/empty state).
- **Invariants:** company isolation preserved — `app_user` is global (no `company_id`); the read
  returns only account identity (`id`, `username`, `email`), never cross-company assignments, and the
  `Employee.user` one-to-one guarantees "unlinked" means linked to no employee anywhere. No ledger
  tables touched; no migration (uses existing tables). The UUID paste path is removed, but linking
  by account id via `POST /employees/:id/link` is unchanged (the picker supplies that id).
