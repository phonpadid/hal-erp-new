## 1. Data Model & Migration

- [x] 1.1 Add `password_reset_token` table to `erp_approval_system.dbml` (id, user_id → app_user.id, token_hash unique, expires_at, consumed_at, created_at; index on (user_id, consumed_at))
- [x] 1.2 Create the `PasswordResetToken` MikroORM entity in the rbac module (extends `BaseEntity`, `@ManyToOne(() => AppUser)`, no company relation)
- [x] 1.3 Generate the MikroORM migration (create table + unique index on token_hash) and verify it applies cleanly

## 2. Backend — Token & Service

- [x] 2.1 Add a `PasswordResetService` (rbac module) with token generation: `crypto.randomBytes(32)` → base64url raw token, SHA-256 `token_hash`, `expires_at = now + 30min`
- [x] 2.2 Implement `requestReset(identifier)`: find one ACTIVE `app_user` by username OR email; on match invalidate the user's outstanding tokens, insert a new token, dispatch the email; always return the same generic result (anti-enumeration)
- [x] 2.3 Implement `verifyToken(rawToken)`: hash and look up by `token_hash`; return `{ valid }` only when `consumed_at` is null and `expires_at` is in the future; never return identity
- [x] 2.4 Implement `setNewPassword(rawToken, newPassword)` inside `em.transactional()` with `LockMode.PESSIMISTIC_WRITE` on the token row: assert valid+unconsumed+unexpired, hash via `PasswordService`, write `app_user.password_hash`, set `consumed_at`, invalidate siblings
- [x] 2.5 Wire email dispatch through the notification `EmailTransport` with link `${WEB_BASE_URL}/reset-password?token=<raw>`; no-op safely when SMTP is unconfigured

## 3. Backend — DTOs & Endpoints

- [x] 3.1 Add class-validator DTOs: `ForgotPasswordDto { identifier }`, `ResetPasswordDto { token, newPassword }` (password policy: min length + complexity)
- [x] 3.2 Add public routes on the existing `AuthController` (no `JwtAuthGuard`): `POST /auth/password/forgot` (200 generic), `GET /auth/password/reset/:token`, `POST /auth/password/reset`
- [x] 3.3 Register `PasswordResetService` in the rbac module and confirm `EmailTransport`/`PasswordService` are injectable there

## 4. Backend — Tests

- [x] 4.1 Unit: `requestReset` creates a token + dispatches on match; creates nothing and returns the identical response on no-match and on inactive account (anti-enumeration)
- [x] 4.2 Unit: `verifyToken` valid vs expired vs consumed; does not consume the token
- [x] 4.3 Unit: `setNewPassword` updates the hash, consumes the token, invalidates siblings; rejects expired/consumed/invalid tokens without changing the password (weak-password rejection is covered at the DTO layer)
- [x] 4.4 Concurrency test: two simultaneous `setNewPassword` calls with the same token — exactly one succeeds under the pessimistic lock (single-use holds)

## 5. Shared Schemas

- [x] 5.1 Add `forgotPasswordSchema` and `resetPasswordSchema` (with password-confirmation match) to `@erp/shared`, mirroring the backend DTOs

## 6. Frontend — Pages & Routing

- [x] 6.1 Add a "Forgot password?" link on `LoginView.vue` (i18n label) linking to `/forgot-password` (login refactored onto a shared `AuthShell`)
- [x] 6.2 Add public routes (`meta.public`): `/forgot-password`, `/forgot-password/sent`, `/reset-password`
- [x] 6.3 Build the request page: `@primevue/forms` + `zodResolver(forgotPasswordSchema)`; on submit call `POST /auth/password/forgot` and route to the sent page (no enumeration in UI copy)
- [x] 6.4 Build the check-email confirmation page (neutral i18n copy, no account detail)
- [x] 6.5 Build the set-new-password page: read `?token=`, verify via `GET /auth/password/reset/:token` on mount, show error+retry link if invalid, else render the new-password form (`zodResolver(resetPasswordFormSchema)` — token comes from the URL, not a form field); on success route to login
- [x] 6.6 Add i18n keys for all new copy in en and la (`front-end/src/i18n/locales/{en,la}/auth.ts`)

## 7. Verification

- [x] 7.1 Run backend + frontend typecheck and unit tests; confirm all pass (backend `tsconfig.build` clean; frontend `vue-tsc` clean for all new files; shared package builds)
- [x] 7.2 Drove the flow end-to-end at the repo's integration altitude: 12 DB-backed tests against a real Postgres exercise request → email-link capture → verify (valid/expired/consumed) → set new password → login-with-new-hash → single-use under concurrency, all green. NOTE: a manual HTTP/browser run was not performed — the app DB (`new_erp`) is unreachable with the provided credentials in this environment, and the `AuthController` is concurrently being edited by a separate email-verification feature. Recommend a manual browser pass once that lands and SMTP/`WEB_BASE_URL` are configured.
