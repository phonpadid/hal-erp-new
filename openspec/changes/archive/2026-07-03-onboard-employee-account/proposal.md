## Why

Creating a login account for an employee (`POST /employees/:id/create-account`) sets `employee.user_id`
but never creates a `user_company_role`. Company access comes **only** from `user_company_role`
([membership.service.ts](../../../back/src/modules/rbac/membership.service.ts)), so the new user
authenticates yet gets `companies: []` and `accessToken: null` — a login that can enter nowhere.
Admins hit this footgun with no signal that a second step (assign a role in a company) is required.

## What Changes

- Add an **atomic onboarding** action that, in one transaction, creates the login account, links it to
  the employee, and grants the employee's user a **first company-role assignment** in the active company —
  so the account can immediately log in. Exposed as `POST /employees/:id/onboard`.
  - **Company** is the admin's active company (from context, never the body), defaulting the grant to the
    company the admin is already working in.
  - **Department** defaults to the employee's own department (overridable to any department in the active
    company); **role** is chosen from the active company's roles.
  - The new membership is created with **`isDefault = true`**, so login auto-selects it and issues a
    company-context token — directly closing the empty-companies / null-token footgun.
  - Guarded by **both** `EMPLOYEE_MANAGE` **and** `RBAC_MANAGE` (account creation + role assignment are
    two authorities; onboarding needs both). The existing account-only `POST /employees/:id/create-account`
    stays for `EMPLOYEE_MANAGE`-only admins who intend to grant access later.
- Add a shared `onboardEmployeeSchema` (username, email, roleId, departmentId, optional validFrom/validTo)
  mirroring the DTO.
- Add a dedicated **onboarding page with a multi-step form** (PrimeVue Stepper), because the combined form
  (account + access) is larger than fits the existing Link dialog:
  - **Step 1 — Account:** username, email (no password; server sets the initial from `USER_PASSWORD`).
  - **Step 2 — Access:** company (fixed to the active company, shown read-only), department (default = the
    employee's), role, optional validity.
  - **Step 3 — Review & confirm:** single submit → `onboard`.
  - Reached from the employee-admin screen for an employee with no account; the entry is shown only to admins
    holding both `EMPLOYEE_MANAGE` and `RBAC_MANAGE`.

## Capabilities

### New Capabilities
- `web-user-onboarding`: a stepped onboarding page that creates an employee's login account and grants first
  company access in one flow.

### Modified Capabilities
- `rbac`: add a requirement to onboard an employee's account atomically — create the `app_user`, link it, and
  create a **default** `user_company_role` in the active company — guarded by both `EMPLOYEE_MANAGE` and
  `RBAC_MANAGE`.
- `web-employee-admin`: add an "Onboard" entry point (for an employee with no account) that opens the
  onboarding page, shown only when the admin holds both `EMPLOYEE_MANAGE` and `RBAC_MANAGE`.

## Impact

- **Backend:** `back/src/modules/rbac/employee.controller.ts` (new `POST :id/onboard`, `@RequirePermissions(EMPLOYEE_MANAGE, RBAC_MANAGE)`),
  `employee.service.ts` (new `onboard(id, dto)` — one `em.transactional`: create `AppUser`, set `employee.user`,
  create `UserCompanyRole` with `company` = active, `isDefault: true`), `employee.dto.ts` (new DTO). Reuses
  `PasswordService` and `USER_PASSWORD`.
- **Shared:** `shared/src/index.ts` — new `onboardEmployeeSchema` + type.
- **Frontend:** new `views/admin/EmployeeOnboardView.vue` (Stepper) + route; `EmployeeAdminView.vue` entry
  button; `api/employees.ts` + `stores/employeeAdmin.ts` (onboard call, load roles/departments); i18n `la`/`en`.
- **Invariants:** company isolation preserved — the membership is created in the **active company only**, from
  context, never the body (invariant 1); `app_user` stays global. Atomic create-account + membership honors the
  UoW rule (single `em.transactional`). Authorization is on codes, not role names (invariant 6). No ledger tables
  touched; no migration (uses existing `app_user`, `user_company_role`). The self-approval/delegation invariants
  are unaffected.
