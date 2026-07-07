## Why

A signed-in user currently has no place to see who they are (identity, email, linked
employee record) or to change their own password while logged in. The existing
`password-reset` capability only covers the *forgotten*-password flow for
*unauthenticated* users via an emailed single-use token — it does not let an
authenticated user rotate a password they still know. This change adds the missing
self-service "My Profile" surface.

## What Changes

- Add an authenticated **read-own-profile** endpoint that returns the signed-in user's
  identity (`username`, `email`, `email_verified_at`, `status`) plus their linked
  `employee` display fields (`full_name`, `position`, department name) for the active
  company, resolved from the JWT — never by an id in the path.
- Add an authenticated **change-own-password** endpoint that requires the user's
  **current** password, verifies it against `app_user.password_hash`, enforces a
  password strength policy, and writes the new hash. It rejects a wrong current
  password and refuses when the new password equals the current one. This is distinct
  from `password-reset` (no email, no token — the user is already authenticated).
- Add a Vue **"My Profile"** page reachable from the topbar profile menu that shows the
  read-only identity/employee fields and hosts a change-password form
  (current / new / confirm) built with `@primevue/forms` + a Zod schema mirroring the
  backend DTO.

## Capabilities

### New Capabilities
- `user-profile`: The backend for an authenticated user to read their own profile and
  change their own password (verifying the current password). Complements
  `password-reset` (unauthenticated) and `user-preferences` (UI settings).
- `web-user-profile`: The Vue "My Profile" page — identity/employee display plus the
  change-password form — linked from the application-shell topbar profile menu.

### Modified Capabilities
<!-- No existing requirement changes. The topbar's existing "profile/logout" element
     (web-app-layout) gains a navigation target but its behavior is unchanged. -->

## Impact

- **Capabilities touched:** `rbac` (this is the authenticated-account surface; reuses
  the JWT-resolved current user behind `GET /auth/me`) and, at the edges,
  `employee-registry` (read-only display of the linked `employee`) and `web-app-layout`
  (the topbar profile menu links to the new page). No requirement in those changes.
- **Data model:** No schema change. Reads `app_user` and `employee` (+ department name);
  the only write is an in-place update of `app_user.password_hash`.
- **Invariants:** Company isolation still holds — the linked employee is read within the
  active company scope only. No budget/quota/ledger surface is touched, so the
  append-only and derived-balance invariants are unaffected. Authorization is by the
  authenticated identity itself (a user acting on their own account), not a
  cross-user permission code.
- **Security:** Change-password must verify the current password, use the same hashing
  as login, and never log or return password material. Consider revoking other sessions
  on success (design decision).
