## Why

The profile page (`ProfileView.vue`) shows identity and employee info but nothing about
what the signed-in user is actually authorized to do in the active company. Users and
support staff currently have no self-service way to see "which role(s) do I have" or
"which permission codes do I hold" without an admin looking it up in RBAC admin — this
change surfaces that read-only, for the user's own session, on the page they already
check to review their account.

## What Changes

- Extend the backend "own profile" read (`GET /auth/profile`) to also return, for the
  active company: the user's role name(s) (a user can hold multiple `role` rows per
  company per the `user_company_role` model) and the full resolved permission-code list
  with each code's effective scope (OWN/DEPARTMENT/COMPANY/GROUP) — the same union the
  `PermissionResolverService` already computes for authorization, just exposed as a read.
- Add a "Roles & Permissions" section to `ProfileView.vue` listing the role name(s) and
  a scope-tagged permission code list for the active company.
- No changes to `GET /auth/me` (JWT-context endpoint) or to how authorization itself is
  computed — this is a read-only projection of existing resolver output, not a new
  permission model.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `user-profile`: "Read Own Profile" requirement gains role name(s) and scoped
  permission codes for the active company in the response.
- `web-user-profile`: "My Profile Page" requirement gains a read-only Roles &
  Permissions section.

## Impact

- Backend: `back/src/modules/rbac/profile.service.ts` (`OwnProfile` interface +
  `getProfile`), reusing `PermissionResolverService.resolve()`
  (`back/src/modules/rbac/permission-resolver.service.ts`) instead of duplicating the
  role/permission union logic. `auth.controller.ts`'s `GET /auth/profile` route is
  unchanged in shape (still one call), only the payload grows.
- Frontend: `front-end/src/api/profile.ts` (`OwnProfile` type), `ProfileView.vue`
  (new read-only section), i18n keys for the new labels.
- No schema/migration changes — no new tables or columns. Uses only existing `role`,
  `role_permission`, `user_company_role`, `permission` tables (read-only).
- No change to `budget_txn`/`approval_log` append-only invariants, no company-isolation
  change (still scoped to the caller's own active company), no self-approval or
  concurrency surface touched.
