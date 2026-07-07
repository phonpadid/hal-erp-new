## 1. Shared type

- [x] 1.1 Add `LinkableAccount = { id: string; username: string; email: string }` (and export it) to `shared/src/index.ts`, near the employee/account schemas.

## 2. Backend — linkable-accounts read

- [x] 2.1 Add `listLinkableAccounts(search?: string): Promise<LinkableAccount[]>` to `back/src/modules/rbac/employee.service.ts`: select `AppUser` rows whose `id` is not referenced by any `Employee.user` (`$nin` subquery over `employee.user_id WHERE user_id IS NOT NULL`), ordered by `username`, capped (~50). When `search` is set, filter `username`/`email` case-insensitively (`$ilike`). Return only `{ id, username, email }`.
- [x] 2.2 Add `GET linkable-accounts` to `employee.controller.ts` (before the `:id` routes so it is not shadowed by a param route), guarded by the existing `EMPLOYEE_MANAGE` (`@RequirePermissions(P.EMPLOYEE_MANAGE)`), accepting an optional `search` query param, delegating to `listLinkableAccounts`.
- [x] 2.3 Confirm the route ordering: `GET /employees/linkable-accounts` must resolve before any `GET /employees/:id`-style handler; add/verify accordingly.

## 3. Frontend

- [x] 3.1 Add `linkableAccounts(search?: string)` to `front-end/src/api/employees.ts` → `GET /employees/linkable-accounts` returning `LinkableAccount[]`, and a corresponding action + state in `stores/employeeAdmin.ts` to load and hold the list.
- [x] 3.2 In `EmployeeAdminView.vue` existing mode, replace the `InputText` bound to `linkModel.userId` with a PrimeVue `Select` (`filter`, `optionValue="id"`, option label `username — email`) whose options are the loaded linkable accounts; keep binding the selected id to `linkModel.userId` so `submitLink` and `employeeLinkSchema` are unchanged. Load the list when the dialog opens in existing mode.
- [x] 3.3 Show an empty state in the picker when there are no unlinked accounts (e.g. disabled Select with an "no accounts available" message).
- [x] 3.4 Update i18n: remove `admin.employee.fields.userIdPlaceholder` / `userIdHelp` "paste UUID" strings, add picker label/placeholder/empty-state keys to `front-end/src/i18n/locales/la/admin.ts` and `en/admin.ts`.

## 4. Tests

- [x] 4.1 Backend unit test: `listLinkableAccounts` returns accounts linked to no employee and excludes any account already linked to an employee (in any company); asserts payload has only `id`/`username`/`email`.
- [x] 4.2 Backend unit test: `search` filters by `username` and `email` case-insensitively.
- [x] 4.3 Backend test: `GET /employees/linkable-accounts` is guarded by `EMPLOYEE_MANAGE` (class-level; generic guard behaviour covered by permissions.guard.spec) and is a static route that is not shadowed by `:id` (employee.controller.spec.ts).
- [x] 4.4 Frontend: store test loads the picker source and submits the chosen id to `link`, empty state on error (employeeAdmin.spec.ts); i18n parity for new/removed keys covered by the generic i18n.parity.spec.
