## Context

Today the only authentication path is `POST /auth/login` → a company-context JWT
(`back/src/auth`). `JwtStrategy.validate()` turns the JWT into an `AuthUser`
(`userId`, `companyId`, `departmentId`, `grants`, `permissionCodes`), which
`PermissionsGuard` and every company-scoped query consume. The grants themselves are
computed by `PermissionResolverService.resolve(userId, companyId)` at token-issue time
(`RbacAuthService.issueFor`), returning `{ departmentId, grants }`, where each `Grant`
is a `{ code, scope }` pair.

External systems cannot use this: there is no interactive user, and JWTs are
short-lived. We need a long-lived, revocable machine credential that produces the
**exact same `AuthUser`** so the entire downstream authorization stack is reused, not
reimplemented.

Custody precedent already exists: `password_reset_token` / `email_verification_token`
store only a SHA-256 **hash** of the raw token; the raw value lives only outside the DB.
API keys follow the same custody model.

## Goals / Non-Goals

**Goals:**
- Issue a per-(user, company) API key whose caller resolves to the same principal that
  user would get by logging in and selecting that company.
- Reuse `PermissionResolverService`, `PermissionsGuard`, and all company-scope filters
  unchanged — the key is a new **authentication source**, not a new **authorization model**.
- Store only a hash of the secret; reveal the raw secret exactly once, at creation.
- Cap key-authenticated requests to read + create/submit; never approve/reject/delegate.
- Full lifecycle: issue, list, revoke, optional expiry, `last_used_at` tracking.
- Attribute key-originated actions in the existing audit trail to both the key and the
  bound user.

**Non-Goals:**
- OAuth2 / client-credentials flows, scoped tokens, or refresh tokens (a raw shared secret
  is sufficient for v1).
- Rate limiting / quotas per key (can be layered later; note it, don't build it).
- A separate "service account" identity type — keys always ride an existing `app_user`.
- Letting a key approve documents, or widening a key's rights beyond the bound user's grants.
- Cross-company keys — a key is bound to exactly one company (invariant #1).

## Decisions

### 1. Key binds to an existing user + one company (not a standalone service account)
The credential resolves to a real `app_user` within one `company_id`. At authentication
time the guard calls the **same** `PermissionResolverService.resolve(userId, companyId)`
used by login, so grants/scopes never drift between the two paths and invariant #8
(no self-approval) holds naturally — the key *is* that user for attribution.
- *Alternative — standalone service-account principal with its own grant set:* rejected;
  it duplicates the grant-resolution and self-approval logic and creates a second identity
  model to keep in sync. Revisit only if truly userless integrations are required.

### 2. New authentication source, identical `AuthUser` output
Add an `ApiKeyGuard` (a `CanActivate`, not a Passport strategy — the credential is a shared
secret, not a bearer JWT) that:
1. Reads the credential from `Authorization: Api-Key <prefix>.<secret>` (falling back to an
   `X-Api-Key` header).
2. Looks up the row by `prefix` (indexed, non-secret), then verifies the secret with a
   constant-time hash compare against `secret_hash`.
3. Rejects if `revoked_at` is set or `expires_at` has passed.
4. Resolves `{ departmentId, grants }` via `PermissionResolverService.resolve(userId, companyId)`
   and attaches the identical `AuthUser` shape to `request.user`, adding an `authSource:
   'api-key'` marker and `apiKeyId`.
5. Best-effort updates `last_used_at` (outside the request transaction; never blocks the call).

A composed guard (`JwtOrApiKeyGuard`) lets endpoints accept either source; endpoints keep
their existing `@RequirePermissions(...)` decorators untouched.

### 3. Operation cap enforced independently of grants
Even if the bound user holds `DOC_*_APPROVE`, a key MUST NOT approve. Enforce with an
explicit **deny-list guard** keyed on `authSource === 'api-key'` applied to approval-class
endpoints (approve/reject/delegate), returning 403 regardless of grants. Rationale: the cap
is a property of the *channel*, not the *permissions*, so it must not be expressible as a
grant that could be widened by mistake.
- *Alternative — model an `API` scope or a per-key allow-list of codes:* deferred; a simple
  channel-level deny of approval-class actions covers v1 and can't be misconfigured open.

### 4. Secret format and hashing
Raw secret = `<prefix>.<random>` where `prefix` is a short public identifier (e.g. `ak_8f3d`,
stored plaintext, indexed, shown in listings) and `<random>` is ≥32 bytes of CSPRNG entropy.
Store `secret_hash = SHA-256(raw)` (mirrors the existing token tables; the secret is
high-entropy so a slow KDF is unnecessary, but bcrypt/argon2 is an acceptable upgrade). The
raw secret is returned **only** in the create response and never again.

### 5. Data model — new `api_key` table
Add to `erp_approval_system.dbml` (CLAUDE.md forbids inventing tables without a proposal —
this change is that proposal):

```
Table api_key {
  id uuid [pk]
  company_id uuid [not null, ref: > company.id]   // single-company binding (invariant #1)
  user_id uuid [not null, ref: > app_user.id]      // principal the key rides
  name varchar [not null]                          // human label, e.g. "Procurement bot"
  prefix varchar [unique, not null]                // public id, indexed lookup, safe to display
  secret_hash varchar [not null]                   // SHA-256 of the raw secret; raw never persisted
  created_by uuid [not null, ref: > app_user.id]   // admin who issued it
  expires_at timestamp                             // null = no expiry
  revoked_at timestamp                             // null until revoked
  last_used_at timestamp                           // best-effort usage marker
  created_at timestamp
  indexes { prefix; (company_id, revoked_at); user_id }
}
```

### 6. Issuance gated by a new permission code `API_KEY_MANAGE`
Add `API_KEY_MANAGE` to the `permission` master (module `MASTER` or `RBAC`). Management
endpoints (`POST/GET/DELETE /api-keys`) require it and are company-scoped: an admin issues
keys only for users who are members (`UserCompanyRole`) of the admin's active company. A key's
grants can never exceed the bound user's resolved grants — no privilege escalation vector.

### 7. Audit attribution
Key-originated writes record the bound `user_id` as actor (so `approval_log` / `created_by`
stay populated as today) plus the `apiKeyId` and `authSource` for traceability. This keeps
existing append-only audit semantics (invariant #2) intact while distinguishing channel.

## Risks / Trade-offs

- **Leaked secret = full bound-user write access within the company** → Mitigate: reveal once,
  store only the hash, support instant revoke (`revoked_at`), optional `expires_at`, surface
  `last_used_at` and prefix in the admin UI for anomaly spotting. Recommend TLS-only.
- **Bound user's permissions change after issuance** → Because grants resolve *live* at each
  request, the key automatically tracks the user's current grants (revoking the user's access
  neuters the key). This is intended, but callers must know a key is not a frozen capability.
- **Deny-list guard forgotten on a new approval endpoint** → Mitigate: apply the deny at the
  approval-workflow module boundary (guard on the controller/route group), plus a test asserting
  every approval-class route rejects `authSource: 'api-key'`.
- **`last_used_at` write on the hot path** → Do it best-effort and out-of-band; a failed update
  must never fail the request, and it must not enlist in the request's `em.transactional()`.
- **Prefix collision** → `prefix` is unique + generated with enough entropy; retry on the rare
  unique-constraint violation at issue time.

## Migration Plan

1. DBML: add `api_key`; generate a MikroORM migration creating the table + indexes.
2. Seed the `API_KEY_MANAGE` permission row (idempotent seeder) and grant it to admin roles.
3. Deploy backend (guard + management endpoints) — additive, no change to existing auth.
4. Deploy the admin UI screen.
5. Rollback: drop the `api_key` table and the permission row; the JWT path is untouched, so
   no existing flow regresses.

## Open Questions

- Should `expires_at` be mandatory with a max TTL (e.g. 1 year) rather than optional? Leaning
  optional for v1 with a UI nudge.
- Do we need per-key scoping *narrower* than the bound user (e.g. restrict a key to a single
  `document_type`)? Deferred unless a concrete integration needs it.
- Rate limiting per key — out of scope for v1; revisit if abuse appears.
