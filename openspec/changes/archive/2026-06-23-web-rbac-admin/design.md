## Context

`RbacAdminController` (`@Controller('rbac')`, class-level `@RequirePermissions('RBAC_MANAGE')`)
is write-only: `POST /roles`, `/role-permissions`, `/assignments`, `/revoke-access`, backed by
`RoleAdminService` (createRole, attachPermission, assignUserRole, revokeCompanyAccess) — all using
`RequestContext.companyId()`. `Role`/`UserCompanyRole` are company-scoped; `Permission`/`AppUser`
are global. `RolePermission` carries a `scope` (OWN/DEPARTMENT/COMPANY/GROUP). Missing for an admin
UI: reads (roles+grants, catalog, users+assignments) and single-grant / single-assignment removal.
The Vue shell + prior slices give `can()`, the typed-api/store pattern, `@primevue/forms` +
`zodResolver`, and the shared `@erp/shared` schema package. Departments for the assign picker come
from the existing `GET /departments`.

## Goals / Non-Goals

**Goals**
- `RBAC_MANAGE` reads (roles+grants, permission catalog, users+assignments) and fine-grained
  removes (detach grant, remove assignment), all active-company scoped.
- Vue access-admin: Roles tab (list/create/grant/detach) + Users tab (list/assign/remove/revoke),
  gated by `RBAC_MANAGE`, forms validated against shared Zod schemas.
- Tests: backend reads + removes; frontend store + shared schemas.

**Non-Goals**
- Delegation management, user-account creation, editing the permission catalog, role templates.

## Decisions

### D1 — Backend reads (extend RoleAdminService)
Add read methods, returning plain DTOs (not entities), all scoped via `RequestContext.companyId()`:
- `listRoles()` → active-company `Role`s with `populate(['rolePermissions.permission'])` →
  `[{ id, code, name, isActive, permissions: [{ code, name, scope }] }]`.
- `listPermissions()` → active `Permission`s → `[{ code, name, module }]` (global catalog).
- `listUsers()` → all `AppUser`s + their active-company `UserCompanyRole`s (populate role,
  department) → `[{ id, username, email, status, assignments: [{ id, roleId, roleCode,
  departmentId, departmentName, isDefault, validFrom, validTo }] }]`. User accounts are global; we
  annotate only the active company's assignments. *Alternative:* a SQL view — rejected; the
  in-memory shape reuses the ORM and is trivial at this scale.

### D2 — Backend fine-grained removes
- `detachPermission(roleId, permissionCode)`: verify the role is in the active company, then
  `nativeDelete(RolePermission, { role, permission })`.
- `removeAssignment(assignmentId)`: load the `UserCompanyRole`, verify `company === active`, then
  remove it. Both reject cross-company ids (NotFound), preserving isolation. Controller adds
  `DELETE /rbac/role-permissions` (body roleId + permissionCode) and `DELETE /rbac/assignments/:id`
  (both inherit the class `RBAC_MANAGE` guard).

### D3 — Shared Zod schemas
Add to `@erp/shared`: `createRoleSchema` (code, name, description?), `attachPermissionSchema`
(roleId, permissionCode, scope ∈ OWN/DEPARTMENT/COMPANY/GROUP), `assignRoleSchema` (userId, roleId,
departmentId, isDefault?, validFrom?, validTo?) — mirroring the backend DTOs so the create/grant/
assign forms validate identically (CLAUDE.md parity rule). Export a `SCOPES` const for the scope
picker.

### D4 — Frontend data layer
`api/rbac.ts`: `roles()`, `permissions()`, `users()`, `createRole`, `attachPermission`,
`detachPermission`, `assign`, `removeAssignment`, `revokeAccess`. `stores/rbacAdmin.ts` (Pinia):
`roles`, `permissions`, `users`, `loading`, `error`; `loadAll()` (roles + permissions + users),
plus action wrappers that refresh after each mutation; capture server errors.

### D5 — Tabbed view + dialogs
`views/admin/RbacAdminView.vue` with PrimeVue `Tabs` (Roles / Users):
- **Roles**: a DataTable of roles; selecting one shows its grants (chips: `code` + `scope`) with a
  detach button; a "New role" dialog (`createRoleSchema`) and an "Add grant" dialog (permission
  `Select` from the catalog + scope `Select`, `attachPermissionSchema`).
- **Users**: a DataTable of users with their assignment chips; an "Assign role" dialog
  (`assignRoleSchema`: role `Select`, department `Select` from `/departments`, default switch,
  validity dates) + per-assignment remove + a "Revoke all access" action.
All forms use `<Form :resolver="zodResolver(schema)">` + `<FormField>` + `<Message>`. Everything is
gated by `can('RBAC_MANAGE')` (the route + nav too).

### D6 — Routing & nav
Route `rbac-admin` (`meta.permission='RBAC_MANAGE'`); an "Access" nav item gated by
`can('RBAC_MANAGE')` (admin only in the seed). Departments fetched via the existing `/departments`.

### D7 — Tests
- Backend (DB-backed, reuse `seedDatabase`): `listRoles` returns the seeded Admin/Approver/
  Requester with their grants; `listPermissions` returns the catalog; `listUsers` returns the
  three demo users with their active-company assignments and excludes a second company's
  assignment; `detachPermission` removes one grant; `removeAssignment` removes one UCR;
  cross-company role/assignment ids are rejected.
- Frontend (Vitest): rbac store with a mocked api (loadAll populates; mutations call the right
  endpoint and refresh; error captured) + shared-schema validation (valid/invalid role, grant,
  assignment; bad scope rejected).

## Risks / Trade-offs

- **Listing all users globally** — `AppUser` is a global directory by design (users span
  companies); we expose username/email/status + only the active company's assignments. Acceptable;
  no cross-company assignment leaks.
- **No optimistic UI** — each mutation re-fetches (simple, authoritative). Fine at admin scale.
- **Locking yourself out** — an admin could detach their own `RBAC_MANAGE`; out of scope to guard
  here (server-side self-lock protection could come later). Noted.

## Migration Plan

`shared`: add the three schemas + `SCOPES`; build. Backend: add the read methods + two deletes +
tests. Frontend: add `api/rbac.ts`, `stores/rbacAdmin.ts`, `RbacAdminView.vue`, router/nav, tests.
`pnpm -r build` + both test suites; `openspec validate web-rbac-admin --type change --strict`.
Rollback = revert the rbac read/delete additions and the `front-end/` + `shared/` additions.

## Open Questions

- Show inactive roles/users? Default: active only in the list, with the create/assign affordances
  the primary actions (no soft-delete toggle this slice).
- Guard against an admin removing their own last `RBAC_MANAGE` grant? Default: not in this slice;
  note as a future server-side safeguard.
