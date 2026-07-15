## Why

External systems (procurement portals, HR systems, RPA bots) currently have no way
to talk to the ERP: the only authentication is an interactive username/password login
that returns a short-lived, human-oriented JWT. Machine-to-machine integrations need a
long-lived, revocable, auditable credential — an API key + secret — so an outside
system can create and submit documents on behalf of a company without a human logging in.

## What Changes

- Introduce **API keys**: a company admin issues a key bound to an existing user and one
  company. The caller presents it as a secret on each request; the server resolves it to
  the **same principal** an interactive login would produce (that user's `company_id`,
  `department_id`, and scoped permission-code grants).
- Add an **API-key authentication path** alongside the JWT path: a new guard accepts a
  key credential (e.g. `Authorization: Api-Key <id>.<secret>`) and populates the identical
  `AuthUser` shape, so every existing permission-code guard and company-scope filter keeps
  working unchanged.
- **Scope of a key is capped to non-approval writes**: keys MAY read and create/submit
  documents (subject to the bound user's permission codes) but MUST NOT approve, reject,
  or perform delegation. Approval stays interactive-only to preserve audit integrity and
  the no-self-approval invariant.
- Add **key lifecycle management**: issue (returns the raw secret exactly once), list,
  revoke, and optional expiry — gated by a new permission code `API_KEY_MANAGE`.
- Store only a **hash of the secret** (same custody model as `password_reset_token`); the
  raw secret is shown once at creation and never persisted.
- Stamp API-key attribution into the existing audit trail (`approval_log` actor, document
  `created_by`) so key-originated actions are traceable to both the key and its bound user.

## Capabilities

### New Capabilities
- `external-api`: API-key credentials for machine-to-machine access — issuance, hashing/
  custody, the authentication guard, request-time resolution to a company-scoped principal,
  the operation cap (read + create/submit, never approve), revocation, and expiry.

### Modified Capabilities
- `rbac`: add the `API_KEY_MANAGE` permission code and the rule that API-key principals are
  resolved to the bound user's company-scoped grants — a new authentication source feeding
  the existing authorization model.

## Impact

- **Data model** — new `api_key` table (scoped by `company_id`, FK to `app_user`), storing
  `secret_hash`, `prefix`, `expires_at`, `revoked_at`, `last_used_at`. Requires a DBML
  addition + migration. No existing table changes.
- **Backend** — new `ApiKeyGuard` / auth source in `back/src/auth`, key-management service +
  controller under `rbac`, and an allow-list check that blocks approval-class endpoints for
  key principals. Existing `JwtAuthGuard`, `PermissionsGuard`, and company-scope logic are
  reused unchanged.
- **Invariants** — reinforces #1 (company isolation: a key is single-company) and #6
  (permission codes, not roles). Guards #8 (no self-approval) by refusing approval via keys.
  No change to budget/quota ledgers (#2–#5) or FX (#7).
- **Frontend** — an admin screen to issue/list/revoke keys (shows the raw secret once).
- **Docs** — external API authentication guide.
