## Why

An employee can only be given login access by linking to an **existing** `app_user`, but there is
no UI — and no backend endpoint — to **create** an `app_user`. Accounts exist only from the seed
script, so an admin who adds a new employee has no way to give them a login. This blocks the normal
onboarding flow ("add employee → let them sign in").

## What Changes

- Add a backend capability to **create a login account and link it to an employee in one atomic
  step**, exposed as `POST /employees/:id/create-account`, guarded by `EMPLOYEE_MANAGE`.
- The admin supplies **only** `username` and `email`. The **password is never typed by the admin**:
  the server hashes an initial password read from the `USER_PASSWORD` environment variable. New
  accounts are created `ACTIVE`.
- Reject the request when the employee already has a linked account, when `username`/`email`
  collide with an existing account, or when `USER_PASSWORD` is not configured.
- Add a shared Zod schema (`createUserAccountSchema`) mirroring the DTO so client and server
  validation cannot drift.
- In the employee-admin **Link account** dialog, add a "create new account" mode: enter
  username + email → account is created and linked in one click. The raw `app_user UUID` paste
  path remains for linking to an already-existing account.

## Capabilities

### New Capabilities
<!-- none — this extends existing rbac and web-employee-admin capabilities -->

### Modified Capabilities
- `rbac`: add a requirement to create an `app_user` login account with a server-side initial
  password (from `USER_PASSWORD`), enforcing username/email uniqueness.
- `web-employee-admin`: extend "Link Employee to a Login Account" so the admin can create a new
  account and link it in one step, without entering a password.

## Impact

- **Backend:** `back/src/modules/rbac/employee.service.ts` (new `createAccount` method, transactional
  create `AppUser` + set `employee.user_id`), `employee.controller.ts` (new route), `employee.dto.ts`
  (new DTO). Reuses `PasswordService`. Reads `USER_PASSWORD` via `ConfigService`/`process.env`.
- **Shared:** `shared/src/index.ts` — new `createUserAccountSchema` + type.
- **Frontend:** `front-end/src/views/admin/EmployeeAdminView.vue`, `stores/employeeAdmin.ts`,
  `api/employees.ts`, and i18n (`la`/`en` `admin.ts`).
- **Config:** new `USER_PASSWORD` env var (documented in `.env.example` / BOOTSTRAP.md).
- **Invariants:** company isolation preserved (`app_user` is global/no `company_id`; the employee is
  loaded in the active company); no ledger tables touched. No migration (uses existing `app_user`).
