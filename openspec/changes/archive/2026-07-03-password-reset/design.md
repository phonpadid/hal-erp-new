## Context

Auth today is login-only. `RbacAuthService.login` verifies credentials against
`app_user` (username/email unique, `password_hash`, `status`) using
`PasswordService` (bcrypt, cost 10) and issues a company-context JWT via
`AuthService`. The notification module already ships an `EmailTransport`
(nodemailer over SMTP) that no-ops when `MAIL_USER` is unset (dev/CI). `app_user`
is **global** — it has no `company_id` — so a password reset is not a
company-scoped operation.

There is currently no way to recover a forgotten password. This design adds a
self-contained reset capability that reuses the existing hashing and email
infrastructure and introduces exactly one new table.

## Goals / Non-Goals

**Goals:**
- Self-service reset: request → email link → set new password.
- Anti-enumeration: request and verify responses never reveal account existence.
- Tokens that are single-use, short-lived, and stored only as hashes.
- Reuse `PasswordService` (bcrypt) and the notification `EmailTransport`.
- Public endpoints (no JWT) and public frontend routes, matching the existing
  `meta.public` login route.

**Non-Goals:**
- Rate limiting / captcha / lockout (noted as a follow-up risk, not built here).
- Changing login, JWT issuance, or per-company grant resolution.
- Admin-initiated password resets or forced rotation.
- SMS/LINE delivery — EMAIL only, via the existing transport.
- Multi-factor auth.

## Decisions

### 1. New table `password_reset_token` (added to the DBML)
```
Table password_reset_token {
  id uuid [pk]
  user_id uuid [not null, ref: > app_user.id]
  token_hash varchar [not null]        // hash of the raw token; raw is never stored
  expires_at timestamp [not null]
  consumed_at timestamp                 // null until used; single-use marker
  created_at timestamp

  indexes {
    token_hash [unique]
    (user_id, consumed_at)
  }
}
```
No `company_id`: `app_user` is global, so this stays clear of invariant 1 (company
isolation). It is **not** an append-only ledger (invariants 2–3 don't apply);
`consumed_at` is a normal single-column update.

**Alternative considered:** store tokens in-memory / Redis. Rejected — adds an
external dependency the stack doesn't yet require, and Postgres gives us
durability and a trivial expiry sweep.

### 2. Token generation and hashing
Generate 32 random bytes via `crypto.randomBytes(32)` and base64url-encode for the
URL. Store a **SHA-256** hash of the raw token (not bcrypt): the token already has
full entropy, so a fast one-way hash is sufficient and lets us look the row up by
`token_hash` in one indexed query. bcrypt (with its per-hash salt) can't be used
for a lookup and is unnecessary for high-entropy secrets.

**Alternative considered:** JWT with an expiry claim and no DB row. Rejected —
can't be revoked/single-used without a server-side record anyway, so the row is
required regardless.

### 3. Endpoints (all public, on the existing `auth` controller)
- `POST /auth/password/forgot` — body `{ identifier }` (username or email). Always
  `200` with a generic body. Looks up one ACTIVE `app_user` by username OR email;
  if found, invalidates siblings, inserts a token, dispatches the email.
- `GET  /auth/password/reset/:token` — verifies without consuming; returns
  `{ valid: boolean }` only (no identity).
- `POST /auth/password/reset` — body `{ token, newPassword }`. Validates the token,
  hashes and writes the new password, sets `consumed_at`, invalidates siblings.

DTOs use class-validator; UUIDs are not exposed. The raw token is treated as an
opaque string param.

### 4. Anti-enumeration
`forgot` and the verify endpoint return constant-shape responses. On `forgot`, the
"no match" and "match" paths return the identical body and status; email dispatch
happens only on match but is not observable to the caller. Timing differences are
accepted as a minor risk (see below).

### 5. Transaction boundary
The set-password path runs in a single `em.transactional(...)`: re-read the token
row `FOR UPDATE` (`LockMode.PESSIMISTIC_WRITE`), assert it is unconsumed and
unexpired, update `app_user.password_hash`, set `consumed_at`, and invalidate the
user's other outstanding tokens — all atomically. The pessimistic lock prevents a
double-submit from consuming the same token twice or setting the password twice.
No `budget_txn` / `quota_usage` writes occur, so invariants 2–4 and the ledger
sequence notes do not apply here; the lock is purely to make token consumption
single-use under concurrency.

### 6. Email dispatch
Reuse `EmailTransport.send` with the reset link
`${WEB_BASE_URL}/reset-password?token=<raw>`. When SMTP is unconfigured the
transport no-ops, so dev/CI never actually mails — tests assert the token row and
the intent, not real delivery. A dedicated `notification_template` code
(e.g. `PASSWORD_RESET`) MAY back the subject/body; otherwise an inline subject/body
is acceptable since this is not a document notification and has no `document_id`.

### 7. Frontend
Three public routes added to the router `meta.public` group:
`/forgot-password` (request), `/forgot-password/sent` (check-email), and
`/reset-password` (set new, reads `?token=`). `LoginView.vue` gains a "Forgot
password?" link. Each form uses `@primevue/forms` + `zodResolver`; schemas live in
the shared package (`@erp/shared`) alongside `loginSchema`, mirroring the DTOs.
The set-password page verifies the token on mount (`GET`) before rendering the
form. New i18n keys under `auth.*` for en + la.

## Risks / Trade-offs

- **No rate limiting** → an attacker can spam `forgot` to send mail or probe
  timing. Mitigation: out of scope here; flag for a follow-up (per-IP/identifier
  throttle + captcha). The generic response already blocks enumeration by content.
- **Timing side-channel** on `forgot` (match does extra DB writes + email enqueue)
  → could leak existence. Mitigation: dispatch email asynchronously / after the
  response so the request path timing is closer between branches; accept residual
  risk for now.
- **Email is the sole recovery channel** → a user with a stale `app_user.email`
  can't self-recover. Mitigation: admin-assisted reset remains available
  out-of-band; not solved here.
- **Clock skew on `expires_at`** → tokens near TTL edge. Mitigation: compare
  against DB `now()`; keep TTL comfortably short (≤ 60 min).
- **SMTP unconfigured in prod** → resets silently no-op. Mitigation: document the
  `MAIL_*` env requirement; the transport already logs when unconfigured.

## Migration Plan

1. Add `password_reset_token` to `erp_approval_system.dbml`; generate a MikroORM
   migration (create table + indexes). Additive only — no data backfill, no
   changes to existing tables.
2. Ship backend service, DTOs, controller routes (public), and email dispatch.
3. Ship shared Zod schemas, frontend routes/pages, and the login link + i18n.
4. Rollback: the feature is additive and self-contained — reverting the code and
   dropping the new table removes it with no impact on login or other capabilities.

## Open Questions

- Should we back the email with a `notification_template` row (`PASSWORD_RESET`)
  for editable copy, or keep subject/body inline in the service? (Leaning inline
  for the first cut; template-driven is a clean follow-up.)
- Exact TTL within the ≤ 60 min ceiling — proposing **30 minutes**.
- Should setting a new password also invalidate existing JWT sessions? Sessions are
  stateless (JWT), so there's no server-side session to revoke; deferred unless a
  token-denylist is introduced later.
