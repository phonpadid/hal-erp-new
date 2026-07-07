## Context

Email delivery already exists: `EmailTransport.sendMail(to, subject, text, ref)`
([notification/transports/transport.ts](../../../back/src/modules/notification/transports/transport.ts)) sends
over SMTP and is a **no-op when `MAIL_USER` is unset** (dev/test) — the reason mail "doesn't send" and an
admin override is needed. `PasswordResetService` + the `password_reset_token` table
([password-reset.service.ts](../../../back/src/modules/rbac/password-reset.service.ts)) are a near-exact
blueprint: `randomBytes(32)` → store SHA-256 hash → email `${WEB_BASE_URL}/reset-password?token=…` →
confirm under a pessimistic lock, single-use + time-limited.

`app_user` has no verification field (only `status`, `created_at`) and there is no verification token table —
both are net-new schema (added to `erp_approval_system.dbml`, then the entity, then a migration). Login is
`RbacAuthService.login` ([rbac-auth.service.ts](../../../back/src/modules/rbac/rbac-auth.service.ts)), which
today gates only on password + `status === 'ACTIVE'`. Account creation is `createAccount`/`onboard` in
`employee.service.ts`. PrimeVue `ToggleSwitch` is available.

## Goals / Non-Goals

**Goals:**
- Send a verification email on account creation; confirm via a tokened public page.
- Block login until the email is verified, with a distinct outcome the UI can explain.
- A verify-only admin toggle in the employee table as the escape hatch when mail is off.

**Non-Goals:**
- No self-service resend flow (the admin toggle is the escape hatch; resend can come later).
- No un-verify. No change to `status`, password reset, onboarding membership, or company isolation.
- No HTML email templates — plain text, like password reset.

## Decisions

**1. Schema: `email_verified_at` timestamp + `email_verification_token` table.**
Add `app_user.email_verified_at timestamp` (nullable; null = unverified) — a timestamp, not a boolean, so we
keep the "when". Add `email_verification_token` mirroring `password_reset_token` exactly (`id`, `user_id`
→ app_user, `token_hash` unique, `expires_at`, `consumed_at`, `created_at`, index `(user_id, consumed_at)`).
Both go into the DBML first (project rule), then the MikroORM entity, then one migration.

**2. `EmailVerificationService` mirrors `PasswordResetService`.**
`sendVerification(user)`: invalidate outstanding tokens for the user, create a token (`randomBytes(32)`,
hash, TTL — use a longer TTL than reset, e.g. 24h, since it's onboarding), email the
`${WEB_BASE_URL}/verify-email?token=…` link via the injected `EmailTransport` (no-op-safe).
`confirm(rawToken)`: in a transaction with `LockMode.PESSIMISTIC_WRITE` on the token row, reject unless
usable, then set `user.email_verified_at = now` and `token.consumed_at = now` (single-use). `markVerified(userId)`:
admin path — set `email_verified_at` if null (idempotent), no token, no email.

**3. Creation hook is best-effort and outside the create transaction.**
`createAccount`/`onboard` create the account (unchanged, still `ACTIVE`), then call
`emailVerification.sendVerification(user)` after commit. The send is best-effort — a mail failure must not
roll back or fail account creation (and is already a no-op when SMTP is off). The account is simply created
unverified.

**4. Login gate: distinct outcome, not generic.**
In `RbacAuthService.login`, after the password + `status` check, if `user.email_verified_at` is null throw a
distinct error (e.g. `ForbiddenException('EMAIL_NOT_VERIFIED')`) — separate from the generic invalid-credentials
path — so `LoginView` can show a specific message. `switch-company`/`issueFor` also refuse an unverified user
(defense in depth). This intentionally layers on top of the onboarding "log in immediately" behavior: the user
still has company access, but must verify (or be admin-verified) first.

**5. Admin verify endpoint reuses the employee surface.**
`POST /employees/:id/verify-account` guarded by `EMPLOYEE_MANAGE` → `employee.service.verifyAccount(id)`:
load the employee in the active company, require a linked account, call `markVerified(user.id)`. Verify-only
and idempotent. Backs the `ToggleSwitch`. The public confirm endpoint is `POST /auth/verify-email` (token in
body), public like the reset-password verify.

**6. Frontend: toggle + public page.**
`EmployeeView`/`Employee` gains `emailVerified: boolean` (derived from `email_verified_at != null`). The
employee-admin table adds a "Verified" column: `<ToggleSwitch>` bound to `emailVerified`, shown only when
`hasAccount`; turning it on calls the verify action then reloads; when already verified it is `disabled`
(one-way). New public `VerifyEmailView.vue` at `/verify-email` reads `?token=`, posts to `/auth/verify-email`,
shows success/failure + a login link. `LoginView` maps the `EMAIL_NOT_VERIFIED` outcome to a specific message.

**7. Config: add `WEB_BASE_URL`.** Add to `.env`/`.env.example` (used to build the link; currently only a
`http://localhost:5173` code fallback).

## Risks / Trade-offs

- **Blocking login is a behavior change**: freshly onboarded users cannot log in until verified. Mitigated by
  the admin verify toggle (works with SMTP off) and a clear login message. This is the explicitly chosen
  behavior.
- **Best-effort email**: if SMTP is configured but the send fails, the account is unverified with no retry.
  Acceptable — the admin toggle is the recovery path; a resend flow is a later addition.
- **Token custody**: only hashes are stored, single-use, time-limited — matching the audited password-reset
  precedent, so no new exposure surface.
- **Idempotent one-way verify**: the admin toggle cannot un-verify; if un-verify is ever needed it is a
  separate, deliberate action, keeping the toggle safe.
