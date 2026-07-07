## Context

`PostActionService.run` executes on full approval inside the approval transaction (`tem`) and is
atomic with the terminal transition. Today `UPDATE_EMPLOYEE` and `TERMINATE_EMPLOYEE` both call
`setEmployeeStatus`, so a promotion/resignation document approves but the employee is unchanged
beyond a status flag. The real logic lives in `EmployeeService.update` (sets
position/salary/job_level) and `EmployeeService.resign` (status `RESIGNED` + expire
`user_company_role` rows in the active company), but each does `this.em.fork().transactional(...)`
and reads `RequestContext.companyId()` — so it cannot run within the post-action's `tem` (its writes
would commit in a separate transaction and not roll back with the approval).

There is no `effective_date` column on `document`; the date and the new values come from the
document's `doc_field_value` rows (the form template defines the fields). The user chose
**apply-on-approval**: the change takes effect when approved, and `effective_date` is recorded for
audit (and used as `valid_to` when expiring roles, so access ends on the effective date).

## Goals / Non-Goals

**Goals:**
- `UPDATE_EMPLOYEE` applies new position/salary/job_level to `related_employee` from the document's
  fields, atomically with approval.
- `TERMINATE_EMPLOYEE` closes the employee and expires the active company's `user_company_role`
  rows as of `effective_date`, atomically with approval.
- One implementation of the personnel change, reused by the manual admin endpoints and the
  post-action.

**Non-Goals:**
- No scheduler / future-dated application, no `personnel_action` table, no new columns.
- No change to the app_user account or other companies (resignation stays company-scoped).
- No new frontend — the generic document flow and employee admin already cover the UX.

## Decisions

**1. Extract `em`-parameterized core methods.** Refactor to
`EmployeeService.applyPromotion(employeeId, { position?, salary?, jobLevel? }, companyId, em)` and
`applyResignation(employeeId, effectiveDate, companyId, em)`, both operating on the passed `em` and
explicit `companyId` (no `RequestContext`, no fork). `update` / `resign` become thin wrappers that
open their own transaction and delegate; the post-action calls the core on `tem`. Chosen so the
exact same logic runs for manual and document-driven paths and the post-action rolls back with the
approval. Alternative (duplicating logic in the post-action) rejected — it would drift from the
admin path.

**2. Read HR values by well-known field name.** The post-action loads the document's
`doc_field_value` rows joined to `form_field.field_name` and reads conventional names —
`new_position`, `new_salary`, `new_job_level`, `effective_date` (absent → skip that field; absent
effective_date → today). Documented as the HR form-field contract, seeded on the `PROMOTE` / `RESIGN`
templates. This keeps behaviour configuration-driven (the names live in the form template) rather
than hardcoding per-type branches beyond the `post_action` switch. `salary` is read/written as a
decimal string (money rule).

**3. Resignation honours the effective date.** `applyResignation` sets `status = RESIGNED` and sets
each active-company `user_company_role.valid_to = effective_date` (resolution keeps a membership
while `valid_to >= today`, so access ends on the effective date rather than yesterday). When no
effective date is given it falls back to the current behaviour (yesterday / immediate).

**4. Post-action stays atomic and bounded-retry.** The HR apply runs inside the existing
`retry(...)` + `tem` in `PostActionService.run`. If it throws after retries, the APPROVED/COMPLETED
transition rolls back and the employee is untouched (never half-applied).

## Risks / Trade-offs

- [Missing/garbled field values (e.g. non-numeric salary)] → Validate field values in the post-action
  (salary parses as a decimal string via `Money`; unknown fields ignored); a hard parse failure
  fails the post-action so approval rolls back rather than writing a bad salary.
- [`related_employee` not set on an HR document] → The post-action is a no-op (logged) when the
  document has no `related_employee`, so a misconfigured type never corrupts data.
- [Refactor regressions in manual resign/update] → Keep the public `update`/`resign` signatures and
  behaviour; cover the wrappers with the existing employee specs plus new post-action tests.
- [Company scope under post-action context] → Pass the document's `company.id` explicitly into the
  core methods rather than reading `RequestContext`, so scope is correct regardless of caller.

Sequence note: the HR post-action writes only `employee.*` and `user_company_role.valid_to` on the
approval `tem`; it touches no `budget_txn` / `quota_usage`, so no ledger transaction is paired — the
transaction boundary exists solely to keep the personnel change atomic with the terminal transition.

## Migration Plan

No schema migration. Seed `PROMOTE` / `RESIGN` document types, their form templates (with the
well-known HR fields), and dept mappings so the flow is exercisable. Rollback is code-only; the
manual admin endpoints keep working through the refactored wrappers.

## Open Questions

- Final field-name contract (`new_position` / `new_salary` / `new_job_level` / `effective_date`) —
  confirm names before seeding the templates so the post-action and forms agree.
