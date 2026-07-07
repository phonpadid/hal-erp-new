## 1. Permissions & Shared Schemas

- [x] 1.1 Add `EMPLOYEE_MANAGE` and `EMP_SALARY_VIEW` to the permission catalog (`back/src/modules/rbac/permissions.ts`) and the catalog seed
- [x] 1.2 Grant `EMPLOYEE_MANAGE` (and `EMP_SALARY_VIEW` where appropriate) to the bootstrap admin role in the seed so the screen is reachable
- [x] 1.3 Add shared Zod schemas in `/shared` for create/update employee, link/unlink, and resignation, with a `valid_to >= valid_from` refinement reused by the assign schema

## 2. Backend — Employee Registry

- [x] 2.1 Add `employee.service.ts` (list/create/update) in `back/src/modules/rbac`, company-scoped via the active-company EntityManager; enforce `(company, emp_code)` uniqueness
- [x] 2.2 Add link/unlink methods that set/clear only `employee.user_id` and never touch `user_company_role` or `app_user`
- [x] 2.3 Add a resignation method that, in one `em.transactional()`, sets `employee.status = 'RESIGNED'` and expires that company's `user_company_role` rows (set `valid_to` to today) for the linked user
- [x] 2.4 Mask `employee.salary` in all reads unless the caller holds `EMP_SALARY_VIEW`
- [x] 2.5 Add `employee.controller.ts` with `GET/POST/PATCH /employees`, link/unlink, and `POST /employees/:id/resign`, each guarded by `EMPLOYEE_MANAGE`; `ParseUUIDPipe` on UUID params; class-validator DTOs mirroring the shared schemas
- [x] 2.6 Register the controller/service in the module

## 3. Backend — Cross-Company Assignment Read

- [x] 3.1 Add `GET /rbac/users/:userId/assignments` on the RBAC admin controller, guarded by `RBAC_MANAGE`
- [x] 3.2 Resolve the requester's `RBAC_MANAGE` companies and return only the target user's **active** assignments intersected with those companies (company, role, department, validity window); read-only, no filter-disable trick

## 4. Backend — Tests

- [x] 4.1 Employee CRUD + company-scope test (no cross-company read/write of employees)
- [x] 4.2 Resignation test: one company revoked, other company access intact, `app_user` untouched; atomicity test (status + expiry commit together or not at all)
- [x] 4.3 Link/unlink test: `user_company_role` unaffected
- [x] 4.4 Salary masking test (with and without `EMP_SALARY_VIEW`)
- [x] 4.5 Cross-company read test: requester sees only companies they administer; expired assignments excluded; no writes performed

## 5. Frontend — Employee Admin

- [x] 5.1 Add `front-end/src/api/employees.ts` typed client for the employee endpoints
- [x] 5.2 Add a Pinia store for employee-admin state (list, pagination, active-company reload)
- [x] 5.3 Add `EmployeeAdminView.vue`: list + create/edit form (Zod-validated), link/unlink-account control with linked-status indicator, and a confirmed resign action
- [x] 5.4 Hide the salary field unless `auth.can('EMP_SALARY_VIEW')`; gate the screen/nav on `EMPLOYEE_MANAGE`
- [x] 5.5 Add the route (meta permission `EMPLOYEE_MANAGE`) and nav entry

## 6. Frontend — Temporal Grants & Cross-Company View

- [x] 6.1 Add `valid_from`/`valid_to` date inputs to the RBAC "Assign role" dialog behind an "acting / temporary" affordance; validate `valid_to >= valid_from` via the shared schema
- [x] 6.2 Show the validity window on assignment rows and flag expired/expiring assignments
- [x] 6.3 Add a read-only cross-company assignments panel/view for a user, calling `GET /rbac/users/:userId/assignments`, with no edit actions
- [x] 6.4 Add i18n strings (en + la) for all new labels

## 7. Verification

- [~] 7.1 Backend builds clean (`nest build`) and non-DB unit specs pass; DB-backed specs (incl. the new employee/cross-company tests) could not run here — no `erp` Postgres reachable (Docker down; pre-existing DB-backed suites fail identically). Run `docker compose up -d postgres && pnpm --filter back test` to execute them.
- [ ] 7.2 Manually verify in the running app: create employee, link user, resign (other company still accessible), assign acting role with window, view cross-company assignments
- [x] 7.3 Confirm light/dark render via PrimeUI tokens; no hardcoded colors (Tag severities + theme `text-muted-color`/`text-*` utilities only; no hex)
