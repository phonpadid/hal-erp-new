## 1. Backend — Employee core (em-parameterized)

- [x] 1.1 Extract `EmployeeService.applyPromotion(employeeId, { position?, salary?, jobLevel? }, companyId, em)` operating on the passed `em` (only provided fields change; `salary` as decimal string; `emp_code`/company immutable).
- [x] 1.2 Extract `EmployeeService.applyResignation(employeeId, effectiveDate, companyId, em)` operating on the passed `em`: set `status=RESIGNED`, expire that company's `user_company_role` rows with `valid_to = effectiveDate` (default immediate when none).
- [x] 1.3 Make the existing `update` / `resign` thin wrappers that open their own transaction + active company and delegate to the core methods (preserve public signatures/behaviour).
- [x] 1.4 Unit tests: promotion changes only provided fields and preserves salary precision; resignation expires only the active company's roles as of the effective date and stays atomic.

## 2. Backend — HR post-actions

- [x] 2.1 Add a helper that reads a document's `doc_field_value` rows keyed by `form_field.field_name` (well-known: `new_position`, `new_salary`, `new_job_level`, `effective_date`).
- [x] 2.2 Implement `UPDATE_EMPLOYEE` in `post-action.service.ts`: resolve `related_employee` (no-op + log if absent), read the HR fields, call `applyPromotion(..., tem)`; fail (roll back) on an unparseable salary.
- [x] 2.3 Implement `TERMINATE_EMPLOYEE`: resolve `related_employee` (no-op + log if absent), read `effective_date`, call `applyResignation(..., tem)`.
- [x] 2.4 Unit tests (inside the approval flow): approving a promotion updates position/salary; approving a resignation sets RESIGNED + expires active-company roles as of effective date; missing `related_employee` is a no-op; a failing apply rolls back the terminal transition.

## 3. Seed / config

- [x] 3.1 Seed `PROMOTE` (post_action `UPDATE_EMPLOYEE`) and `RESIGN` (post_action `TERMINATE_EMPLOYEE`) document types, form templates carrying the well-known HR fields (`new_position` / `new_salary` / `new_job_level` / `effective_date`), and dept mappings + a workflow, so the flow is exercisable through the generic document UI.

## 4. Verification

- [x] 4.1 Backend unit tests green (`vitest`); existing employee + approval specs still pass after the refactor.
- [ ] 4.2 Manual smoke: create a PROMOTE document for an employee (new salary + effective date), approve it, confirm the employee record updates; create a RESIGN document, approve it, confirm status RESIGNED and the active company's roles expired while another company's access remains.
