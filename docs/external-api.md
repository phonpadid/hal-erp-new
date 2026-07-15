# External API — Authentication with API keys

External systems (procurement portals, HR systems, RPA bots) integrate with the ERP using
**API keys**: long-lived, revocable credentials that let a machine act on behalf of a company
without an interactive login. A key is issued by a company admin, bound to one user and one
company, and — on every request — resolves to the **same principal** that user would get by
logging in and selecting that company.

## What a key can and cannot do

- **Can** read, and create/submit documents — subject to the bound user's permission codes.
- **Cannot** approve, reject, or delegate approval. This bar is a property of the API-key
  channel itself: it holds even when the bound user personally holds `DOC_APPROVE`. Approval
  stays interactive-only, which keeps the audit trail and the no-self-approval rule intact.
- Is confined to **one company**. A key never reads or writes another company's data.
- Carries **no more authority than the bound user currently holds**. Grants are resolved live
  on each request, so changing (or revoking) the user's access immediately changes the key's.

## Issuing a key (admin)

Requires the `API_KEY_MANAGE` permission. In the app: **API keys → New API key**, choose a
name, the bound user (a member of the active company), and an optional expiry.

Or via the API:

```
POST /api-keys
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{ "name": "Procurement bot", "targetUserId": "<uuid>", "expiresAt": "2027-01-01" }
```

Response (the raw secret is shown **once** and is never retrievable again):

```json
{ "id": "…", "prefix": "ak_8f3d1a2b", "secret": "ak_8f3d1a2b.<random>", "name": "Procurement bot", "expiresAt": "2027-01-01T00:00:00.000Z" }
```

Store `secret` securely (a secret manager / CI secret). Only its SHA-256 hash is kept
server-side; the platform cannot recover a lost secret — issue a new key instead.

## Using a key (external system)

Present the raw secret on each request, either as an `Api-Key` authorization scheme or an
`X-Api-Key` header:

```
Authorization: Api-Key ak_8f3d1a2b.<random>
```

```
X-Api-Key: ak_8f3d1a2b.<random>
```

Then call the document endpoints exactly as a JWT client would, e.g.:

```
POST /documents            # create a draft
POST /documents/:id/submit # submit for approval (reserves budget/quota)
GET  /documents/:id        # read status
```

A request that tries an approval action (`POST /documents/:id/actions`,
`POST /documents/:id/start`) with a key is rejected with **403** regardless of the bound
user's grants.

## Lifecycle: revoke, expiry, usage

- **Revoke** — **API keys → Revoke**, or `DELETE /api-keys/:id`. Takes effect immediately; a
  revoked key authenticates no further requests. Revocation is a state change (the row and its
  history are preserved), not a delete.
- **Expiry** — an expired key (`expiresAt` in the past) stops authenticating automatically.
- **Visibility** — the listing shows each key's name, public `prefix`, bound user, status
  (active / revoked / expired), expiry, and `last_used_at` for anomaly spotting. It never shows
  the secret or its hash.

## Error responses

| Situation | Status |
| --- | --- |
| Missing / malformed / wrong secret | 401 |
| Revoked or expired key | 401 |
| Bound user lost access to the company | 401 |
| Key used on an approval endpoint | 403 |
| Bound user lacks the required permission code for the action | 403 |

## Security notes

- Always call over TLS — the secret is a bearer credential.
- Treat a leaked secret as fully compromising the bound user's write access **within that one
  company**; revoke immediately and issue a replacement.
- A key is not a frozen capability: it tracks the bound user's live permissions.
