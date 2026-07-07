## Why

The RBAC backend already supports time-bounded grants (`user_company_role.valid_from`/`valid_to`), a
separate employee registry (`employee` table distinct from `app_user`), and per-company role
assignment. But three of the original RBAC requirements are unreachable through the product:

- **Acting / temporary authority (req 5)** — the backend accepts `valid_from`/`valid_to`, yet the
  RBAC admin "Assign role" dialog has no date fields, so an admin cannot grant temporary or
  standing-in authority without hand-crafting an API call.
- **Employee registry separated from user account (req 6)** — the `employee` table and the
  resignation post-action exist, but there is **no API and no screen** to manage employees, link an
  employee to a login account, or trigger a resignation that revokes only one company's access.
- **One user's roles across the group (req 2)** — an admin can only see/manage a user's assignments
  in the currently active company; there is no consolidated, read-only view of where a person holds
  authority across the group.

This change closes those three gaps so the RBAC capability is usable end-to-end, not just present in
the data model.

## What Changes

- **Employee registry API (new)** — CRUD for `employee` records scoped to the active company:
  list/create/update, link/unlink an `app_user`, and a resignation action that deactivates the
  employee **and** expires only that company's `user_company_role` rows (never the shared account or
  other companies' access).
- **Employee registry admin UI (new)** — a screen to manage the company's employees, see whether
  each is linked to a login account, link/unlink, and mark resigned.
- **Temporal / acting grant UI (modified)** — add `valid_from`/`valid_to` (and an "acting/temporary"
  affordance) to the RBAC "Assign role" dialog, and surface the validity window on assignment rows so
  expiring/expired grants are visible.
- **Cross-company assignment read (modified)** — a read-only, permission-gated endpoint and view that
  shows one user's **active** assignments across every company the requesting admin is authorized to
  see (role, company, department, validity window). Read-only; no cross-company writes.

No data-model or migration changes are expected — `employee`, `user_company_role.valid_from/valid_to`,
and `app_user` already exist in the DBML. This is API + UI surface over existing tables.

## Capabilities

### New Capabilities
- `employee-registry`: Backend management of per-company employee records, their optional link to a
  global `app_user` account, and resignation that affects one company only.
- `web-employee-admin`: Frontend admin screen for the employee registry (list, create/edit, link to a
  user account, mark resigned), permission-gated and scoped to the active company.

### Modified Capabilities
- `rbac`: Add a read-only **cross-company assignment read surface** — given a user, return their
  active assignments across the companies the requester is authorized for. Existing company-isolation
  and time-bounded-grant requirements are unchanged; this adds an explicitly read-only group view.
- `web-rbac-admin`: The "Assign role" flow SHALL let an admin set a validity window
  (`valid_from`/`valid_to`) for acting/temporary authority and display it; add a per-user
  cross-company assignments view (read-only).

## Impact

- **Backend**: new `employee` controller/service + DTOs in `back/src/modules/rbac` (or a new
  `employee` module reusing the `Employee` entity); a new read endpoint on `rbac-admin.controller.ts`
  for cross-company assignments; reuse of the existing resignation post-action logic.
- **Frontend**: new employee-admin view + route + Pinia store + API client; changes to
  `RbacAdminView.vue` assign dialog (date fields) and a cross-company user panel; new `shared` Zod
  schemas mirroring the employee DTOs.
- **Invariants to respect**:
  - *Company isolation (1)* — employee CRUD is company-scoped; the cross-company read is **read-only**
    and gated per company the requester may access, never a write path across companies.
  - *Permission codes, not roles (6)* — new endpoints guard on a permission code
    (e.g. `EMPLOYEE_MANAGE`, `RBAC_MANAGE`), never a role name.
  - *Resignation affects one company only* — resignation expires that company's `user_company_role`
    and the `employee.status`, leaving `app_user` and other companies untouched.
- **Dependencies**: builds on `rbac` and `multi-company`; no changes downstream of `master-data`.
