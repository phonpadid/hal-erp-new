## Context

`employee` and `app_user` are deliberately separate: a registry record is independent of a login
account, and linking touches only `employee.user_id` (`employee.service.ts`). Today `link(id, userId)`
requires an `app_user` that already exists, but the only way `app_user` rows appear is the seed script
(`back/src/seed/seed-data.ts`) — there is no create endpoint on `rbac-admin.controller.ts` and no UI.
`app_user` has no `company_id` (single login across companies); the employee is company-scoped.
Passwords are hashed one-way by `PasswordService` (bcryptjs, cost 10). Env is available via the
global `ConfigModule` (`app.module.ts`) / `process.env`.

## Goals / Non-Goals

**Goals:**
- Let an `EMPLOYEE_MANAGE` admin create a login account and link it to an employee in one atomic step.
- Keep the password out of the admin's hands: initial password comes from `USER_PASSWORD` (server env).
- Reuse the existing link semantics (set `employee.user_id`) and `PasswordService`.
- Share one Zod schema between the Vue form and the Nest DTO.

**Non-Goals:**
- No password reset, "send invite", or force-change-on-first-login flow (future work).
- No general standalone Users-admin CRUD screen (this change is scoped to create-and-link).
- No change to authentication, role assignment, resignation, or unlink behavior.
- No new table or migration — `app_user` already exists.

## Decisions

**1. New endpoint `POST /employees/:id/create-account` (not a new `rbac` route).**
The operation is driven from the employee screen and its only meaningful result is a *linked*
employee, so it lives beside `link`/`unlink` on the employee controller and returns the same
`EmployeeView`. Alternative — a generic `POST /rbac/users` plus a separate link call — was rejected:
it needs two round-trips, can leave an orphan account if the second call fails, and exposes account
creation without the employee-onboarding guardrails. Guarded by `EMPLOYEE_MANAGE`, consistent with
`link`.

**2. Admin supplies only `username` + `email`; password is server-side.**
`createUserAccountSchema = { username, email }`. The service reads `USER_PASSWORD` from config, and
`passwordHash = PasswordService.hash(USER_PASSWORD)`. Rationale: matches the request ("ไม่ให้ admin
กรอก password") and avoids transmitting plaintext passwords through the admin UI. If `USER_PASSWORD`
is unset/empty the service throws (fail closed) rather than creating a password-less or default
account.

**3. Atomicity and validation order.** In a single `em.transactional`:
load the employee in the active company → reject if it already has a linked account → check
`username`/`email` uniqueness (rely on the DB unique constraints, catch and translate to a 400) →
create `AppUser {username, email, passwordHash, status: 'ACTIVE'}` → set `employee.user = user` →
flush. Either both the account and the link commit, or neither does — no orphan account.

**4. Frontend: extend the existing Link dialog rather than a new screen.**
The dialog gets two modes: "link existing" (current UUID paste) and "create new" (username + email).
This keeps the create path exactly where the admin already goes to give login access.

## Risks / Trade-offs

- **Shared initial password for all new accounts** → Everyone starts with the same `USER_PASSWORD`.
  Mitigation: document that `USER_PASSWORD` is an onboarding secret and that a
  change-password/reset flow is planned; keep accounts `ACTIVE` but note the follow-up. Acceptable
  for the current internal-admin scope.
- **Uniqueness race on `username`/`email`** → Two concurrent creates could pass an app-level check.
  Mitigation: the DB unique constraints on `app_user.username`/`email` are the source of truth;
  the service catches the unique-violation and returns a 400, so the constraint (not the pre-check)
  is authoritative.
- **`USER_PASSWORD` misconfiguration** → creating accounts would fail. Mitigation: fail closed with
  a clear error; add to `.env.example` and BOOTSTRAP.md so it is set in every environment.

## Migration Plan

No DB migration. Add `USER_PASSWORD` to environment config (`.env.example`, BOOTSTRAP.md, and the
deploy env). Rollback is code-only: revert the new route/method/schema/UI; no data shape changes.

## Open Questions

- Should the initial password force a change on first login? Deferred — out of scope; flagged as
  follow-up.
