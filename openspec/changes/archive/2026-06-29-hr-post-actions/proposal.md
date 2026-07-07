## Why

The HR post-actions are stubs: on full approval `UPDATE_EMPLOYEE` only sets the employee's
`status` to `ACTIVE` and `TERMINATE_EMPLOYEE` only sets it to `TERMINATED`. Neither applies the
real personnel change — a promotion does not update `position` / `salary` / `job_level`, and a
resignation does not revoke the employee's company-scoped `user_company_role` access. The domain
logic exists (`EmployeeService.update` and `EmployeeService.resign`) but is reachable only through
manual admin endpoints and runs in its own transaction, so it cannot be invoked atomically from the
post-action. As a result, approving a promotion or resignation document records the approval but
changes nothing about the employee.

## What Changes

- **Promotion (`UPDATE_EMPLOYEE`).** On full approval the post-action SHALL read the document's
  field values for the new `position` / `salary` / `job_level` (well-known field names) and an
  `effective_date`, and apply them to the document's `related_employee`, recording the effective
  date for audit. (Decision: apply on approval; no scheduler.)
- **Resignation (`TERMINATE_EMPLOYEE`).** On full approval the post-action SHALL close the
  `related_employee` (status `RESIGNED`) and expire that company's `user_company_role` rows for the
  linked user as of the document's `effective_date`, leaving the shared `app_user` and other
  companies untouched.
- **Transactional reuse.** The employee promotion/resignation core SHALL be refactored into
  `em`-parameterized methods so both the existing manual admin endpoints and the new post-action run
  the same logic — the post-action inside the approval transaction, so it rolls back with the
  terminal transition on failure.
- **Seed/config.** Seed `PROMOTE` (post_action `UPDATE_EMPLOYEE`) and `RESIGN` (post_action
  `TERMINATE_EMPLOYEE`) document types with form templates carrying the well-known HR fields, so the
  flow is exercisable through the existing generic document UI.

## Capabilities

### New Capabilities
<!-- None — behaviour belongs to existing capabilities. -->

### Modified Capabilities
- `approval-workflow`: add an HR post-actions requirement — `UPDATE_EMPLOYEE` applies the
  promotion fields and `TERMINATE_EMPLOYEE` applies the resignation, atomically with approval.
- `employee-registry`: resignation SHALL support an effective date and be applyable within a passed
  transaction; add a promotion-application requirement (position/salary/job_level).

## Impact

- **Backend:** `approval` module — `post-action.service.ts` (`UPDATE_EMPLOYEE` / `TERMINATE_EMPLOYEE`
  read field values + apply via the employee core); `rbac` module — extract
  `EmployeeService.applyPromotion(employeeId, changes, em)` and `applyResignation(employeeId,
  effectiveDate, em)` operating on a passed `em`, with `update`/`resign` delegating to them. Seed HR
  document types + templates.
- **Frontend:** none new — promotion/resignation documents are created, submitted, and approved
  through the existing generic document UI, and the employee admin already reflects status/position/
  salary. Configuring the HR document types/forms uses the existing doc-config admin.
- **Data model:** no new tables or columns. Uses `document.related_employee_id`, the document's
  `doc_field_value` rows (new position/salary/job_level/effective_date), `employee.*`, and
  `user_company_role.valid_to`.
- **Invariants:** company isolation (resignation expires only the active company's roles); the
  post-action stays atomic with the terminal transition and rolls back on failure; permission codes
  unchanged; money (`salary`) carried as decimal/string, never a JS number.
