## Context

Authenticated users have `GET /auth/me` (from `rbac`) which returns the *resolved
company context*, and `user-preferences` stores their UI settings, but there is no
surface for "my account": the identity fields on `app_user`, the linked `employee`
display info, or a way to rotate a known password. `password-reset` deliberately
handles only the *unauthenticated* forgotten-password case (email + single-use token)
and must not be reused here — the change-password flow starts from an authenticated
session and proves ownership with the *current* password instead of an email token.

Constraints from the project: identity lives on `app_user` (`username`, `email`,
`password_hash`, `status`, `email_verified_at`); an `employee` row (optionally) links to
the user via `employee.user_id` and carries `full_name`, `position`, `department_id`.
Company isolation means the employee/department must be resolved within the *active*
company from the JWT. No schema change is needed.

## Goals / Non-Goals

**Goals:**
- Read-own-profile: one authenticated endpoint that resolves the current user from the
  JWT and returns identity + linked-employee display fields for the active company.
- Change-own-password: one authenticated endpoint that verifies the current password,
  enforces a strength policy, and updates `app_user.password_hash` — with no email and
  no token.
- A Vue "My Profile" page (read-only identity + change-password form) linked from the
  topbar profile menu, validated client-side by a Zod schema mirroring the DTO.

**Non-Goals:**
- Editing identity fields (username/email) or employee data from this page — read-only
  display only. Email change / verification stays out of scope.
- Admin-managed password resets or the forgotten-password flow (owned by
  `password-reset` / `web-password-reset`).
- Avatar upload, 2FA, or profile pictures.
- UI-settings/theme editing (owned by `user-preferences`).

## Decisions

- **Separate capability from `password-reset`.** Change-password is authenticated and
  proves ownership via the current password; reset is unauthenticated and token-based.
  Folding them together would blur two different trust models. Alternative (extend
  `password-reset`) rejected: it would force a token abstraction onto an already-trusted
  session.
- **Identify the user by JWT, never by a path id.** Both endpoints act on "me". Routes
  are `GET /me/profile` (or reuse the `rbac` auth surface — see Open Questions) and
  `POST /me/change-password`. This removes any IDOR surface: a user can only ever read
  or mutate their own account.
- **Reuse the login password hasher and comparator.** The change-password service
  verifies the current password with the exact primitive login uses (same argon2/bcrypt
  config) and hashes the new one the same way, so credentials stay consistent. Never log
  or echo password material.
- **Policy in a shared Zod schema.** One Zod schema (min length, complexity, and
  `new !== current`, `confirm === new`) is the single source of truth; the client uses it
  via `zodResolver` and the backend DTO mirrors it with class-validator. Prefer a shared
  schema package so the two cannot drift (per frontend conventions).
- **Linked employee is optional.** `employee.user_id` may be null (accounts without an
  employee record) — the profile response returns identity always and employee fields
  only when a linked `employee` exists in the active company; the page renders gracefully
  when absent.
- **Wrong-current-password returns a generic 4xx**, distinct from validation errors, and
  does not reveal hashing details. Rate-limit is desirable (see Risks).

## Risks / Trade-offs

- [A stolen session can silently change the password] → Require the current password
  (already decided); optionally revoke other active sessions / tokens on success and
  surface "you were signed out elsewhere". Session revocation depends on how JWTs are
  invalidated today (Open Questions).
- [Brute-forcing the current password via the change endpoint] → Apply the same
  rate-limiting/lockout policy the login endpoint uses; return a generic failure.
- [Client/server policy drift] → Enforce with one shared Zod schema; add a test that the
  backend rejects a payload the client would reject and vice-versa.
- [Company scope leak via the linked employee] → Resolve `employee`/department strictly
  within the active company; never join across companies.

## Migration Plan

No data migration — no schema change. Ship backend endpoints behind the existing auth
guard, then the web page and topbar link. Rollback is removing the routes and the page;
no persisted state to unwind. The only mutation is an in-place `password_hash` update,
which is idempotent-safe to redeploy.

## Open Questions

- Route placement: mount under the `rbac` auth surface (`/auth/change-password`,
  extend `/auth/me`) or a new `/me/*` namespace? Prefer `/auth/*` for cohesion with
  existing auth endpoints unless the team wants a dedicated profile controller.
- Should a successful password change revoke other sessions? Depends on current JWT
  invalidation strategy (stateless vs. server-side session/allowlist).
- Exact password strength policy (min length, character classes) — align with whatever
  `password-reset` set-new-password already enforces so all three flows agree.
