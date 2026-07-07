## Context

Company access is derived exclusively from `user_company_role` — `MembershipService.listForUser`
([membership.service.ts:24](../../../back/src/modules/rbac/membership.service.ts)) queries it, and
`RbacAuthService.login` issues a token only when a default/sole company exists
([rbac-auth.service.ts:50-55](../../../back/src/modules/rbac/rbac-auth.service.ts)). `createAccount`
([employee.service.ts:212](../../../back/src/modules/rbac/employee.service.ts)) creates the `AppUser`
and sets `employee.user_id` but never writes `user_company_role`, so onboarded users log in with
`companies: []` and `accessToken: null` (confirmed against the live `phet` account).

Assigning a role is `assignUserRole` ([role-admin.service.ts:78](../../../back/src/modules/rbac/role-admin.service.ts)),
which creates a `UserCompanyRole` in the active company and requires `userId`, `roleId`, `departmentId`
(department is a non-nullable FK on the entity). It lives under `RbacAdminController`, guarded by
`RBAC_MANAGE`. The `PermissionsGuard` requires **all** listed codes (`required.every`,
[permissions.guard.ts:32](../../../back/src/auth/permissions.guard.ts)). PrimeVue `Stepper`/`StepPanel`
is available; the router gates each route on a single `meta.permission`.

## Goals / Non-Goals

**Goals:**
- One atomic action that creates the account, links it, and grants a **default** first-company membership,
  so the onboarded user can log in and get a token immediately.
- A stepped page for the larger combined form; company fixed to the active company.

**Non-Goals:**
- No standalone user-management CRUD. No change to `create-account` (account-only) or to `link`/`unlink`.
- No multi-company onboarding (one company — the active one — per onboarding); more companies via the
  existing RBAC assignment path.
- No password entry (unchanged: initial password from `USER_PASSWORD`).

## Decisions

**1. New atomic endpoint `POST /employees/:id/onboard`, guarded by both codes.**
`@RequirePermissions(P.EMPLOYEE_MANAGE, P.RBAC_MANAGE)` — the guard's `every` semantics make this "both".
`onboard(id, dto)` runs a single `em.transactional`: load the employee in the active company, reject if it
already has an account, read+hash `USER_PASSWORD` (fail closed), validate `roleId` and `departmentId` belong
to the active company, `em.create(AppUser, {..., status:'ACTIVE'})`, set `employee.user`, then
`em.create(UserCompanyRole, { user, company: activeCompany, department, role, isDefault: true, validFrom,
validTo })`, flush once. Username/email unique-violation → `BadRequestException` (DB authoritative), same as
`createAccount`. Kept on the employees controller (not rbac) because it is employee-initiated onboarding; the
second permission code supplies the RBAC authority.

**2. Membership is `isDefault: true`.** This is the footgun fix: `login` auto-selects a default company and
issues a token. If the employee's user later gets more companies, only this first one is default.

**3. Company from context, department defaults to the employee's.** Company is never taken from the body
(invariant 1). `departmentId` defaults to `employee.department` in the UI but is sent explicitly and
re-validated server-side against the active company; `roleId` likewise validated against the active company's
roles.

**4. Account-only `create-account` stays.** An `EMPLOYEE_MANAGE`-only admin keeps the existing create-and-link
(no access yet); onboarding-with-access is the both-permissions path. This avoids forcing `RBAC_MANAGE` onto
every employee admin while still offering the one-click happy path to those who have both.

**5. Frontend: dedicated Stepper page, not the dialog.** New `EmployeeOnboardView.vue` at route
`/employee-admin/:id/onboard` (name `employee-onboard`). Steps: Account (username/email) → Access (company
read-only = active company, department default = employee's, role Select, optional validity) → Review → one
submit to `onboard`. Reuse the shared `onboardEmployeeSchema` (per-step slices) for validation. The route
`meta.permission` gates on `EMPLOYEE_MANAGE`; because the router meta carries a single code, the page and the
`EmployeeAdminView` entry button additionally check `auth.can('RBAC_MANAGE')` and hide/redirect when missing —
mirroring the server's both-codes guard. Roles/departments for the pickers come from existing reads
(`rbacApi.roles`, the org departments read already used by `EmployeeAdminView`).

**6. Shared schema.** `onboardEmployeeSchema = { username, email, roleId(uuid), departmentId(uuid),
validFrom?, validTo? }`, mirrored by `OnboardEmployeeDto` (class-validator) so client/server can't drift.

## Risks / Trade-offs

- **Two-permission gate via a single-code router meta.** The router can only gate one code; the second
  (`RBAC_MANAGE`) is enforced by an in-page/entry check plus the server guard. The client check is UX only —
  the server's `every` guard is authoritative, so a hand-crafted request without both codes still 403s.
- **Coupling account creation with RBAC assignment** raises the permission bar for the one-click flow. Mitigated
  by keeping account-only `create-account` for `EMPLOYEE_MANAGE`-only admins.
- **`isDefault: true` on every onboarding** could unset intent if an employee is later onboarded again — but
  onboarding is offered only for an employee with no account, so it runs once per employee.
- **Department/role validity** must be checked against the active company to avoid cross-company grants; the
  service re-validates rather than trusting the client.
