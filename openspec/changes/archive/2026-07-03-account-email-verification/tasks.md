## 1. Schema (DBML → entity → migration)

- [x] 1.1 In `erp_approval_system.dbml`: add `email_verified_at timestamp` to `app_user` (note: null until confirmed; blocks login while null), and add a new table `email_verification_token` mirroring `password_reset_token` (`id`, `user_id` ref app_user, `token_hash` unique not null, `expires_at` not null, `consumed_at`, `created_at`, index `(user_id, consumed_at)`).
- [x] 1.2 In `back/src/modules/rbac/rbac.entities.ts`: add `emailVerifiedAt?: Date` (`columnType: 'timestamptz', nullable`) to `AppUser`; add `EmailVerificationToken` entity mirroring `PasswordResetToken` (tokenHash unique, expiresAt, consumedAt, user FK, createdAt).
- [x] 1.3 Add a MikroORM migration: `alter table app_user add column email_verified_at`, and `create table email_verification_token` with the unique + FK + index (mirror `Migration20260703000000` for password_reset_token).

## 2. Backend — verification service

- [x] 2.1 Create `back/src/modules/rbac/email-verification.service.ts` mirroring `password-reset.service.ts`: inject `EntityManager` + `EmailTransport`. `sendVerification(user)`: invalidate outstanding tokens, create a token (`randomBytes(32)`, SHA-256 hash, TTL ~24h), email `${WEB_BASE_URL}/verify-email?token=…` via `EmailTransport.sendMail` (no-op-safe).
- [x] 2.2 Add `confirm(rawToken)`: in `em.transactional` with `LockMode.PESSIMISTIC_WRITE` on the token row, reject (`BadRequestException`) unless unconsumed+unexpired, then set `user.emailVerifiedAt = new Date()` and `token.consumedAt = new Date()` (single-use); invalidate the user's other outstanding tokens.
- [x] 2.3 Add `markVerified(userId)`: set `emailVerifiedAt` only if currently null (idempotent, one-way); no token, no email.
- [x] 2.4 Register `EmailVerificationService` in `rbac.module.ts` providers/exports (and ensure `EmailTransport` is available to it, as it is to `PasswordResetService`).

## 3. Backend — creation hooks, login gate, endpoints

- [x] 3.1 In `employee.service.ts` `createAccount` and `onboard`: after the account is created/committed, call `emailVerification.sendVerification(user)` best-effort (must not fail or roll back account creation). Inject `EmailVerificationService` into `EmployeeService`.
- [x] 3.2 In `rbac-auth.service.ts` `login`: after the password + `status === 'ACTIVE'` check, if `user.emailVerifiedAt` is null throw a distinct `ForbiddenException('EMAIL_NOT_VERIFIED')` (not the generic invalid-credentials path). Apply the same guard in `issueFor`/switch-company (defense in depth).
- [x] 3.3 Add `employee.service.verifyAccount(id)`: load the employee in the active company, require a linked account (`BadRequestException` otherwise), call `markVerified(user.id)`, return the updated `EmployeeView`.
- [x] 3.4 Add `POST :id/verify-account` to `employee.controller.ts` guarded by `EMPLOYEE_MANAGE`, delegating to `verifyAccount`.
- [x] 3.5 Add a public `POST /auth/verify-email` route (token in body) → `EmailVerificationService.confirm`; mark it public like the reset-password verify route.
- [x] 3.6 Surface `emailVerified` in `EmployeeView.toView` (`emailVerified: !!e.user?.emailVerifiedAt`) and in the `EmployeeView` interface.

## 4. Shared + config

- [x] 4.1 Add `emailVerified: boolean` to the shared/employee view type surfaced to the client (mirror the backend `EmployeeView`).
- [x] 4.2 Add `verifyEmailSchema = z.object({ token: z.string().min(1) })` to `shared/src/index.ts` (mirrors the verify-email DTO).
- [x] 4.3 Add `WEB_BASE_URL` to `back/.env.example` (and document it); the service falls back to `http://localhost:5173`.

## 5. Frontend

- [x] 5.1 Add `emailVerified` to the `Employee` type in `front-end/src/api/employees.ts`; add `verifyAccount(id)` → `POST /employees/:id/verify-account`, and a store action in `stores/employeeAdmin.ts`.
- [x] 5.2 In `EmployeeAdminView.vue`, add a "Verified" column with `<ToggleSwitch v-model>` bound to the row's `emailVerified`, rendered only when `data.hasAccount`; turning it on (when currently off) calls the verify action then reloads; when already verified render it `disabled` (one-way).
- [x] 5.3 Create a public `VerifyEmailView.vue` at route `/verify-email` (meta public): read `token` from the query, `POST /auth/verify-email`, show success (with a login link) or an invalid/expired state.
- [x] 5.4 In `LoginView.vue`, map an `EMAIL_NOT_VERIFIED` login response to a specific "email not verified" message (distinct from the generic error).
- [x] 5.5 Add i18n keys (verified column/toggle, verify-email page states, login unverified message) to `front-end/src/i18n/locales/la/*.ts` and `en/*.ts`.

## 6. Tests

- [x] 6.1 Backend unit test: `sendVerification` creates a hashed, unconsumed, unexpired token (raw not stored); `confirm` with the raw token sets `emailVerifiedAt` and consumes it; a reused/expired/invalid token is rejected and changes nothing.
- [x] 6.2 Backend unit test: `createAccount`/`onboard` leave the account unverified and issue a verification token; account creation still succeeds when the email step is a no-op (SMTP off).
- [x] 6.3 Backend unit test: login is denied with `EMAIL_NOT_VERIFIED` for a valid, `ACTIVE`, unverified account, and succeeds after `markVerified`.
- [x] 6.4 Backend unit test: `verifyAccount` (admin path) sets `emailVerifiedAt`, is idempotent (unchanged on re-verify), requires a linked account, and never sends email.
- [x] 6.5 Backend test: `POST :id/verify-account` requires `EMPLOYEE_MANAGE`; `POST /auth/verify-email` is public.
- [x] 6.6 Frontend: `verifyEmailSchema` validation; store `verifyAccount` posts + refreshes; i18n parity for new keys across `la`/`en`.
