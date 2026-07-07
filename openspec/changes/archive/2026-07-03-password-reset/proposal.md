## Why

A user who forgets their password currently has no self-service way back into the
system — the only route is `/auth/login`, and there is no reset path. This forces
manual intervention and leaves accounts stranded. We need a secure, self-service
reset flow that lets a user prove control of their registered email and set a new
password, without leaking whether any given account exists.

## What Changes

- Add a **self-service password reset** flow:
  - Request a reset by username **or** email. The response is always generic — it
    never reveals whether an account matched (anti-enumeration).
  - Generate a **single-use, time-limited** reset token, store only its hash, and
    email a reset link to the account's registered address.
  - Verify a token (validity + not expired + not consumed) so the UI can decide
    whether to render the "set new password" form.
  - Set a new password against a valid token: hash it with the existing
    `PasswordService`, mark the token consumed, and invalidate any other
    outstanding tokens for that user.
- Add a new table to store reset tokens (**proposed in `erp_approval_system.dbml`**).
- Send the reset email through the existing notification EMAIL transport (SMTP /
  nodemailer); no-op in dev/CI when SMTP is unconfigured.
- Frontend: add a **"Forgot password?"** link on `LoginView`, plus three public
  pages — request reset, check-your-email confirmation, and set-new-password from
  the emailed link.

## Capabilities

### New Capabilities
- `password-reset`: Backend self-service reset — request/verify/consume a
  single-use, time-limited, hashed reset token; anti-enumeration responses;
  password update via the existing hashing service; email dispatch of the link.
- `web-password-reset`: Frontend public pages — the "Forgot password?" entry on
  login, the request form, the check-email confirmation, and the token-driven
  set-new-password form, all validated with Zod schemas mirroring the DTOs.

### Modified Capabilities
<!-- None. Login (rbac) behavior is unchanged; reset is a new, self-contained capability. -->

## Impact

- **Data model**: new `password_reset_token` table (id, user_id, token_hash,
  expires_at, consumed_at, created_at) added to `erp_approval_system.dbml`; new
  migration + MikroORM entity.
- **Backend**: new endpoints under the existing `auth` controller
  (`POST /auth/password/forgot`, `GET /auth/password/reset/:token`,
  `POST /auth/password/reset`), all **public** (no JWT). Reuses `PasswordService`
  (bcrypt) and the notification `EmailTransport`.
- **Frontend**: `LoginView.vue` gains a link; new routes/pages under the public
  (`meta.public`) group; new Zod schemas in the shared package; new i18n keys
  (en + la).
- **Invariants**: reset tokens are **not** company-scoped — a user account is
  global (`app_user` has no `company_id`), so this stays clear of invariant 1
  (company isolation). No budget/quota/ledger surface is touched. Password reset
  does not bypass company-context authorization: a reset only restores login;
  per-company grants are still resolved at login as today.
- **Security**: generic responses on request + verify (no user enumeration);
  tokens stored hashed, single-use, short TTL; setting a new password consumes the
  token and invalidates siblings.
