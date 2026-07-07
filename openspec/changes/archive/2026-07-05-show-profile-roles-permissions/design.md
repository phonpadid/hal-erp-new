## Context

`ProfileView.vue` already renders `OwnProfile` from `GET /auth/profile`
(`profile.service.ts#getProfile`). Separately, `PermissionResolverService.resolve(userId,
companyId)` already computes the exact thing we want to show: for a user's active
company, the union of permission codes across every `user_company_role` membership,
each tagged with its resolved scope (OWN/DEPARTMENT/COMPANY/GROUP, broadest wins), plus
role identification via those memberships. This is a read-only, additive change — no new
tables, no write path, no budget/quota surface.

## Goals / Non-Goals

**Goals:**
- Show the caller their own role name(s) and resolved permission codes (with scope) for
  the currently active company, on the existing profile page.
- Reuse `PermissionResolverService` as the single source of truth for the permission
  union, so this view can never drift from what the authorization guard actually
  enforces.

**Non-Goals:**
- No change to `GET /auth/me`, JWT contents, or how `PermissionsGuard` authorizes
  requests.
- No cross-company view — only the active company, same scoping as the rest of the
  profile page.
- No editing of roles/permissions from this page (that's `RBAC_MANAGE` admin surface,
  already covered by the `rbac` capability).

## Decisions

- **Reuse `PermissionResolverService.resolve()` instead of re-querying
  `RolePermission`/`UserCompanyRole` in `ProfileService`.** Alternative considered:
  have `ProfileService` run its own aggregation query. Rejected — that would duplicate
  the scope-ranking logic (`SCOPE_RANK`, broadest-wins) and risk the profile page
  showing a permission list that doesn't match what the guard actually grants. Since
  `resolve()` already returns `{ departmentId, grants: {code, scope}[] }`, `ProfileService`
  can call it directly and also read the underlying `UserCompanyRole[]` (with `role`
  populated) for the role names — same query path the resolver already does.
- **Role names, not role IDs, and no de-duplication beyond what MikroORM naturally
  returns.** A user can hold multiple `role` rows in one company
  (`user_company_role` is unique on `(user_id, company_id, role_id)`, not one-per-user);
  the profile response lists every held role's `name`, not just the default one.
- **Permission list is the full resolved grant list, not filtered by module.** Keeping
  it a flat `{ code, scope }[]` (same shape as the JWT `Grant[]`) avoids inventing a new
  response shape; the frontend groups/sorts client-side for display.
- **No caching layer.** This is a low-traffic, single-user read (one profile page per
  session load); reuse the resolver's existing per-request computation rather than
  adding a cache with its own invalidation problem.

## Risks / Trade-offs

- [Exposing full permission code list could look like a large payload if a role has many
  grants] → In practice grant counts are small (tens, not hundreds) per company; no
  pagination needed.
- [Duplication risk if `ProfileService` and `PermissionResolverService` drift] →
  Mitigated by the reuse decision above — `ProfileService` calls the resolver rather
  than reimplementing the union/scope-rank logic.
- [Frontend could imply permissions are editable here] → Section is explicitly
  read-only, no action buttons, mirrors the read-only employee block already on the
  page.
