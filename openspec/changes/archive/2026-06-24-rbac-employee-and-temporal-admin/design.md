## Context

The RBAC backend (archived `2026-06-22-implement-rbac`) and the RBAC admin UI
(`2026-06-23-web-rbac-admin`) are live. Three originally-scoped RBAC requirements are
present in the data model but not reachable through the product:

- `user_company_role.valid_from` / `valid_to` exist and are honored by
  `PermissionResolverService`, but no UI sets them.
- The `employee` table (distinct from `app_user`, `user_id` nullable per DBML note
  "พนักงานบางคนอาจไม่มี account ระบบ") and the resignation post-action exist, but there is no
  CRUD API and no screen.
- `GET /rbac/users` is scoped to the active company; no consolidated view of one person's
  authority across the group.

Constraints: company isolation (invariant 1), permission-codes-not-roles (invariant 6),
and "resignation affects one company only" (rbac spec). `employee.salary` is sensitive and
gated by `EMP_SALARY_VIEW` per the DBML.

## Goals / Non-Goals

**Goals**
- Make temporal/acting grants settable and visible in the RBAC admin UI.
- Provide an employee-registry API + admin screen, with link/unlink to an `app_user` and a
  resignation action that revokes only the active company's access.
- Provide a read-only cross-company view of a single user's active assignments.

**Non-Goals**
- No data-model or migration changes (all tables/columns already exist in the DBML).
- No HR features beyond the registry (no payroll, no leave — those live in quota/other caps).
- No cross-company **write** path. The group view is read-only.
- No bulk import of employees (future change).

## Decisions

**D1. Employee module reuses the existing `Employee` entity, lives under `back/src/modules/rbac`.**
The entity is already defined in `rbac.entities.ts` and referenced by the resignation
post-action. A new `employee.controller.ts` + `employee.service.ts` beside the RBAC admin
controller keeps the identity/registry concern together. Alternative (separate `employee`
module) rejected — it would split the resignation logic across modules for no gain.

**D2. Two permission codes: `EMPLOYEE_MANAGE` (registry CRUD + resignation) and `EMP_SALARY_VIEW`
(salary field visibility).** Registry management is a distinct authority from `RBAC_MANAGE`
(an HR clerk maintains employees without granting roles). Salary is masked unless the caller
holds `EMP_SALARY_VIEW`, matching the DBML note. Alternative (fold into `RBAC_MANAGE`) rejected:
conflates HR data entry with access administration.

**D3. Resignation reuses the existing post-action path, in one `em.transactional()`.** The
resignation action sets `employee.status = 'RESIGNED'` and expires that company's
`user_company_role` rows (set `valid_to` to today) atomically. It never touches `app_user` or
other companies' rows. This mirrors the existing `revokeCompanyAccess` semantics; the employee
action wraps both writes so they commit together.

**D4. Temporal grants are an additive change to the existing assign DTO/flow.** `valid_from` /
`valid_to` already flow through `assignRoleSchema` and the assign endpoint; only the UI form and
the assignment display change. An "acting/temporary" toggle in the dialog reveals the date
fields; an empty window means a standing assignment. Expired/expiring assignments are flagged in
the list (e.g. a tag) so admins can see lapsing authority.

**D5. Cross-company read is a dedicated read-only endpoint:
`GET /rbac/users/:userId/assignments` returning the user's **active** assignments across every
company the requester holds `RBAC_MANAGE` in.** The server intersects "companies the user is
assigned in" with "companies the requester may administer," so no isolation leak: an admin only
sees companies they already govern. Returns role, company, department, validity window — no
writes. Alternative (enable the `company` filter off, like GROUP reporting) rejected: that would
expose companies the requester has no authority over.

**D6. Shared Zod schemas in `/shared` mirror the new employee DTOs**, consistent with existing
RBAC schemas, so client and server validation cannot drift.

## Risks / Trade-offs

- **[Cross-company read could leak data across companies]** → Restrict the result to the
  intersection of the target user's companies and the requester's `RBAC_MANAGE` companies;
  never disable the company filter; read-only; covered by a test asserting a requester sees only
  companies they administer.
- **[Salary exposure]** → Mask `salary` in list/detail responses unless the caller holds
  `EMP_SALARY_VIEW`; assert with a test.
- **[Resignation partially applied]** → Wrap status update + role expiry in a single
  `em.transactional()`; a concurrency/atomicity test confirms both or neither.
- **[UI lets an admin set valid_to before valid_from]** → Zod refinement (`valid_to >= valid_from`)
  shared by client and server.
- **[Unlinking a user from an employee accidentally removes access]** → Unlink only clears
  `employee.user_id`; it does NOT touch `user_company_role`. Documented and tested as independent.

## Migration Plan

No DB migration. Steps: (1) add `EMPLOYEE_MANAGE` / `EMP_SALARY_VIEW` to the permission catalog
seed; (2) ship backend employee module + cross-company read endpoint; (3) ship shared schemas;
(4) ship frontend employee-admin view, route, store, and the assign-dialog date fields. Rollback
is removal of the new endpoints/views — no data changes to revert. Existing seeds must grant
`EMPLOYEE_MANAGE` to the bootstrap admin role so the screen is reachable.

## Open Questions

- Should resignation be reversible (re-activate a `RESIGNED` employee and re-grant access), or is
  re-hire a fresh assignment? Proposed: re-hire is a new assignment; resignation is one-way on the
  employee record. Confirm with stakeholders.
- Should the cross-company view be available to a future group-level role (e.g. `GROUP_HR_VIEW`)
  in addition to per-company `RBAC_MANAGE`? Out of scope here; note for a later change.
