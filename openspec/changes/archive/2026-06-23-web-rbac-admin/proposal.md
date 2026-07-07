## Why

Every screen built so far is gated by permission codes, but the only way to grant a code or
assign a role is to re-run the seed. There's no UI to manage authorization, and the RBAC backend
is **write-only** — it can create a role, attach a permission, assign a user, and bulk-revoke
company access, but it can't *read* roles, the permission catalog, or who's assigned, and it
can't remove a single grant or assignment. This change adds the missing reads + fine-grained
removes and builds the access-admin screens, so an admin can manage authorization without
re-seeding — unlocking every other capability.

## What Changes

- **New capability `web-rbac-admin`** — roles, permissions, and user-assignment screens in the
  Vue shell.
- **Backend (rbac delta)** — all `RBAC_MANAGE`, all scoped to the active company:
  - `GET /rbac/roles` → the active company's roles, each with its granted permissions
    (`{ code, name, scope }`).
  - `GET /rbac/permissions` → the permission catalog (`{ code, name, module }`) for the grant
    picker.
  - `GET /rbac/users` → users with their active-company assignments (`{ roleId, roleCode,
    departmentName, isDefault, validFrom/To }`); user accounts are global, assignments are
    company-scoped.
  - `DELETE /rbac/role-permissions` (roleId + permissionCode) → detach a single grant.
  - `DELETE /rbac/assignments/:id` → remove a single user-role assignment.
- **Roles & permissions** (`RBAC_MANAGE`): list roles, create a role, view a role's grants, add a
  grant (permission code + data-visibility scope), and detach a grant.
- **User assignments** (`RBAC_MANAGE`): list users with their assignments, assign a role (role +
  department + default + optional validity window), remove a single assignment, and revoke all of
  a user's access to the active company.
- **Shell integration**: an "Access" nav entry (gated by `RBAC_MANAGE`) opening a tabbed view
  (Roles / Users); a typed `api/rbac.ts` + a Pinia store; create/assign forms use
  `@primevue/forms` + `zodResolver` with schemas shared in `@erp/shared`.
- **Tests**: backend tests for the reads (roles+grants, catalog, users+assignments scoped to the
  company) and the removes; frontend unit tests for the rbac store and the shared schemas.

## Capabilities

### New Capabilities
- `web-rbac-admin`: the Vue access-admin screens — manage roles, their permission grants
  (code + scope), and user-role assignments, permission-gated and company-scoped.

### Modified Capabilities
- `rbac`: adds an authorization **read surface** (roles + grants, permission catalog, users +
  assignments) and **fine-grained revocation** (detach one grant, remove one assignment),
  complementing the existing write/bulk-revoke operations. Existing requirements are unchanged.

## Impact

- **Affected**: `front-end/` (new tabbed view, store, api, router/nav) and
  `back/src/modules/rbac/` (read methods + two delete endpoints) and `shared/` (Zod schemas) with
  tests.
- **Invariants reflected**: 5 (authorize on permission codes — this is the screen that manages
  them; whole area gated by `RBAC_MANAGE`, server enforces); 1 (roles and assignments scoped to
  the active company; user accounts are global by design); validation parity (shared Zod schema).
- **Consumes**: existing `POST /rbac/roles`, `/role-permissions`, `/assignments`,
  `/revoke-access`, plus the new reads and deletes.
- **No schema change**; no new dependency.

## Out of Scope

- Approval **delegation** management (one-hop delegation lives in the approval capability) —
  a later `web-approval-config` slice.
- Creating user **accounts** (sign-up / password reset) — assignments only; accounts are assumed
  to exist (seeded or provisioned elsewhere).
- Editing the permission catalog itself (codes are owned by the modules, invariant 5) — the
  catalog is read-only here.
- Per-company role cloning / templates and bulk assignment.
