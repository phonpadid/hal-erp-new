## Why

Accounts are created (via create-account / onboard) as immediately usable with no confirmation that the
email address is real or reachable. There is no email verification. We want new accounts to receive a
verification email and to require a verified email before login — but SMTP is a no-op when `MAIL_USER` is
unset (dev/test), so mail often "doesn't send". Admins therefore need a way to mark an account verified by
hand so a real person is never locked out when the email never arrives.

## What Changes

- **Send a verification email on account creation.** When an account is created (both
  `POST /employees/:id/create-account` and `POST /employees/:id/onboard`), generate a single-use,
  time-limited token, store only its hash, and email the user a `${WEB_BASE_URL}/verify-email?token=…`
  link — mirroring the existing password-reset flow and reusing `EmailTransport.sendMail`.
- **Track verification state.** Add `app_user.email_verified_at` (nullable timestamp; null = unverified)
  and a new `email_verification_token` table (net-new schema — proposed against the DBML).
- **Block login until verified.** Authentication SHALL reject an account whose email is not verified with a
  distinct "email not verified" outcome (separate from bad credentials), so the UI can explain it. `status`
  (ACTIVE/RESIGNED) is unchanged and stays orthogonal.
- **Admin manual verify (verify-only).** Add a `Verified` column with a **`<ToggleSwitch>`** in the
  employee-admin table (for employees that have an account). Turning it on calls a new
  `EMPLOYEE_MANAGE`-guarded endpoint that marks the account verified **without** sending mail — the escape
  hatch when SMTP is off. The switch is one-way: already-verified rows show it on and disabled; it cannot
  un-verify.
- **Public verify page.** Add a public `/verify-email` page that consumes the token and confirms the
  account, and a login message telling an unverified user to check their email / ask an admin.
- Add `WEB_BASE_URL` to `.env`/`.env.example` (currently only a code fallback).

## Capabilities

### New Capabilities
- `web-account-verification`: the public verify-email page (consumes the token) and the login "email not
  verified" messaging.

### Modified Capabilities
- `rbac`: account creation triggers a verification email; a new single-use email-verification token; login
  requires a verified email; an `EMPLOYEE_MANAGE` admin can mark an account verified without email. New
  schema: `app_user.email_verified_at` + `email_verification_token`.
- `web-employee-admin`: add a verify-only `ToggleSwitch` per account row that marks the account verified.

## Impact

- **DBML/migration:** `erp_approval_system.dbml` — add `app_user.email_verified_at` and table
  `email_verification_token` (mirror `password_reset_token`); new MikroORM migration.
- **Backend:** `rbac.entities.ts` (`AppUser.emailVerifiedAt`, new `EmailVerificationToken`), new
  `email-verification.service.ts` (send + confirm, mirroring `password-reset.service.ts`), a hook in
  `employee.service.ts` `createAccount`/`onboard` to send the mail, `rbac-auth.service.ts` login gate,
  `employee.controller.ts` admin verify route (`EMPLOYEE_MANAGE`), a public `auth.controller.ts` verify route,
  `rbac.module.ts` wiring. Reuses `EmailTransport`.
- **Shared:** `shared/src/index.ts` — surface `emailVerified` in the employee view type.
- **Frontend:** `EmployeeAdminView.vue` (ToggleSwitch column) + `api/employees.ts`/`stores/employeeAdmin.ts`
  (verify action); new public `VerifyEmailView.vue` + route; `LoginView.vue` unverified message; i18n `la`/`en`.
- **Config:** `WEB_BASE_URL`.
- **Invariants:** `app_user` stays global (no `company_id`); tokens store only a hash (raw only in the link),
  single-use + time-limited, matching the password-reset precedent. Company isolation and the onboarding
  default-membership behavior are unchanged — verification is a per-account gate layered on top of login.
  No ledger tables touched.
