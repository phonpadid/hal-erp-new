## 1. Shared schema

- [x] 1.1 Add `onboardEmployeeSchema = z.object({ username: z.string().min(1).max(255), email: z.string().email().max(255), roleId: z.string().uuid(), departmentId: z.string().uuid(), validFrom: z.string().optional(), validTo: z.string().optional() })` and its `OnboardEmployeeInput` type to `shared/src/index.ts`, near `createUserAccountSchema`.

## 2. Backend — atomic onboard

- [x] 2.1 Add `OnboardEmployeeDto` (username, email, roleId, departmentId, optional validFrom/validTo; class-validator, `@IsUUID` on ids) to `back/src/modules/rbac/dto/employee.dto.ts`, mirroring the shared schema.
- [x] 2.2 Add `onboard(id, dto)` to `employee.service.ts` in a single `em.transactional`: load the employee in the active company; reject if it already has a linked account; read `USER_PASSWORD` and throw `BadRequestException` if unset/empty; validate `roleId` and `departmentId` belong to the active company (throw `BadRequestException` otherwise); hash the password; `em.create(AppUser, { username, email, passwordHash, status: 'ACTIVE' })`; set `employee.user`; `em.create(UserCompanyRole, { user, company: activeCompany ref, department, role, isDefault: true, validFrom, validTo })`; flush once. Translate username/email unique-violation to a `BadRequestException`.
- [x] 2.3 Add `POST :id/onboard` to `employee.controller.ts` guarded by `@RequirePermissions(P.EMPLOYEE_MANAGE, P.RBAC_MANAGE)` (both codes; guard uses `every`), delegating to `onboard`. Place it with the other `:id` POST routes.
- [x] 2.4 Ensure `RBAC_MANAGE` is exported from `permissions.ts` as `P.RBAC_MANAGE` and available to the controller (it is used by RbacAdminController already).

## 3. Frontend — API + store

- [x] 3.1 Add `onboard(id, dto)` to `front-end/src/api/employees.ts` → `POST /employees/:id/onboard`, and an `onboard` action to `stores/employeeAdmin.ts` (reuse the `run()` helper so the list refreshes).
- [x] 3.2 Ensure the store/view can load the active company's roles (`rbacApi.roles`) and departments (the same source `EmployeeAdminView` already uses) for the access-step pickers.

## 4. Frontend — stepped onboarding page

- [x] 4.1 Create `front-end/src/views/admin/EmployeeOnboardView.vue` using PrimeVue `Stepper`/`StepPanel`: Step 1 Account (username, email), Step 2 Access (company shown read-only = active company; department Select defaulted to the employee's department; role Select from active-company roles; optional validFrom/validTo), Step 3 Review + confirm. Validate with `onboardEmployeeSchema` (per-step field slices); no password field.
- [x] 4.2 On confirm, call the store `onboard` action; on success navigate back to `employee-admin` with a success toast; show server errors inline.
- [x] 4.3 Add route `{ path: 'employee-admin/:id/onboard', name: 'employee-onboard', component: EmployeeOnboardView, meta: { permission: 'EMPLOYEE_MANAGE' } }` to `router/index.ts`; in the view, additionally guard on `auth.can('RBAC_MANAGE')` and redirect back to `employee-admin` when missing (mirrors the server's both-codes guard).
- [x] 4.4 In `EmployeeAdminView.vue`, add an "Onboard" action for an employee with no account that routes to `employee-onboard`; show it only when `auth.can('EMPLOYEE_MANAGE') && auth.can('RBAC_MANAGE')`.
- [x] 4.5 Add i18n keys (page title, step labels, field labels, review labels, onboard button) to `front-end/src/i18n/locales/la/admin.ts` and `en/admin.ts`.

## 5. Tests

- [x] 5.1 Backend unit test: `onboard` creates an `ACTIVE` account, links it, and creates a `user_company_role` in the active company with `isDefault = true`; the created user then resolves that company as default (via `MembershipService.listForUser`) — i.e. login would issue a token.
- [x] 5.2 Backend unit test: `onboard` is atomic on failure — rejects and persists nothing when the employee already has an account, when username/email collide, when the role or department is not in the active company, and when `USER_PASSWORD` is unset.
- [x] 5.3 Backend test: the `onboard` route requires both `EMPLOYEE_MANAGE` and `RBAC_MANAGE` (controller metadata lists both codes; the guard's `every` semantics are covered by permissions.guard.spec).
- [x] 5.4 Concurrency test: two concurrent onboards for distinct employees with the same username — exactly one succeeds, the other gets a 400 (unique constraint authoritative), and the loser leaves no membership.
- [x] 5.5 Frontend: store `onboard` action posts and refreshes; `onboardEmployeeSchema` validation (valid passes; missing role/email fails); i18n parity for the new keys across `la`/`en`.
