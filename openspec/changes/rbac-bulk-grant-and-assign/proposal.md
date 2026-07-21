## Why

Granting permissions to a role and assigning roles to a user are both one-at-a-time
operations today: pick a single option in a `Select`, submit, repeat. Worse than the click
count, every single submit round-trips a write **and then re-pages the entire role catalog
plus the users table** (`reloadMutable`), so onboarding a role with twenty permission codes
costs twenty writes and twenty full reloads. Setting up a new company's access model — the
first thing an administrator does — is the slowest screen in the product.

The fix is to let the administrator express the whole intent at once (multi-select) and to
give the server a bulk write surface that applies it atomically, so the client writes once
and reloads once.

## What Changes

- **Role permission manager becomes a multi-select diff editor.** The manage-permissions
  surface lists the full catalog grouped by `module` with a checkbox per permission —
  checked means the role holds it. The administrator ticks/unticks freely and commits once;
  the client sends the *diff* (grants to add, grants to remove). This folds today's separate
  add-control and per-chip remove into one surface.
- **Per-grant scope is preserved.** A checked row exposes its data-visibility scope
  (`OWN`/`DEPARTMENT`/`COMPANY`/`GROUP`), defaulting to `DEPARTMENT`, with a "set scope for
  all checked" bulk control. Changing the scope of an already-held grant is part of the diff.
- **Assign-role dialog becomes multi-role.** Department, default flag, and the optional
  acting window are chosen once as shared context; the administrator then checks multiple
  roles and commits one batch, producing one assignment per checked role against that shared
  context. Assigning across departments still means one batch per department.
- **New bulk write endpoints.** `POST /rbac/role-permissions/bulk` and
  `POST /rbac/assignments/bulk` apply a batch inside a single `em.transactional(...)`.
- **Bulk writes are idempotent on duplicates.** The single-item `attachPermission` and
  `assignUserRole` throw `ConflictException` when the grant/assignment already exists. In a
  batch that is not an error — an already-satisfied item is reported as skipped, not fatal.
  Single-item endpoints keep their current 409 behaviour.
- Existing single-item endpoints are retained; the UI simply stops being the only way to
  reach them. **No breaking API change.**

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `rbac`: adds a bulk grant/assign write surface — batched role-permission and user-role
  writes that are atomic per batch, idempotent on already-present items, `RBAC_MANAGE`-gated,
  and confined to the active company.
- `web-rbac-admin`: the *Role and Permission Management* requirement changes from a
  single-pick add control to a checkbox diff editor over the full catalog; the *User Role
  Assignments* requirement changes from one assignment per submit to a multi-role batch over
  a shared department/default/window context.

## Impact

**Backend** (`back/src/modules/rbac/`)
- `rbac-admin.controller.ts` — two new `@Post` routes, same `RBAC_MANAGE` guard.
- `role-admin.service.ts` — `attachPermissionsBulk`, `assignUserRolesBulk`; existing
  single-item methods refactored so the batch path reuses their validation rather than
  duplicating it.
- `dto/` — bulk DTOs with `class-validator` (`@ValidateNested`, `@ArrayMaxSize`).
- Tests: `rbac-admin.spec.ts` (batch atomicity, duplicate-skip, cross-company rejection).

**Shared** (`shared/src/index.ts`)
- `bulkAttachPermissionsSchema`, `bulkAssignRolesSchema` — the single source of truth the
  Vue forms and the Nest DTOs both mirror.

**Frontend** (`front-end/src/`)
- `views/admin/RbacAdminView.vue` — manage-permissions dialog and assign dialog rewritten.
- `api/rbac.ts` — `attachPermissionsBulk`, `assignBulk`.
- `stores/rbacAdmin.ts` — bulk actions; one `reloadMutable()` per batch instead of per item.
- i18n en/la keys for the new chrome (bulk scope control, diff summary, partial-skip notice).

**Invariants**
- *Company isolation* is the live risk: a batch must resolve every role, permission, user,
  and department against the **active company** before writing, and reject the whole batch
  if any item escapes it — a partially-validated batch must not commit.
- *Permission codes, not role names* — both routes stay gated on `RBAC_MANAGE`.
- Budget/quota ledger invariants are untouched; this change writes no `budget_txn`.
