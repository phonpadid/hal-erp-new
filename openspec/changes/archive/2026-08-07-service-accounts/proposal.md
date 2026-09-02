## Why

An integration identity such as `claim-bot` — the account HAL's claim system authenticates as —
can only be created two ways today, and both are wrong.

The first is a script. `back/scripts/setup-claim-dev.ts` builds `claim-bot` correctly: no
password, a `CLAIM_BOT` role with four `DOC_*` grants at `DEPARTMENT` scope, and a company
membership. But it is a dev script, so standing up an integration in a new company means
running code against production rather than administering the system.

The second is the UI, and it is worse. **No screen in the app creates an `app_user`.** The RBAC
admin's Users tab only assigns and revokes roles on accounts that already exist; it has no "new
user" action. Every account-creating path in the product hangs off the *employee* screen —
`POST /employees/:id/create-account` and `POST /employees/:id/onboard` — so creating a bot
means first inventing a fake employee for something that is not a person. Worse, both paths set
an initial password from the `USER_PASSWORD` env, which hands the bot a working interactive
login it must never have.

This change touches **rbac** and its admin screen. No budget, quota, document, approval, FX, or
ledger path is involved.

## What Changes

- A new identity kind on `app_user`: a **service account**, explicitly flagged rather than
  inferred, that authenticates only by API key.
- A guarded endpoint (`RBAC_MANAGE`) creates a service account together with its first
  company-role assignment in one atomic call, mirroring how employee onboarding grants
  membership. Doing both at once matters: the API-key admin only lists users who already hold an
  ACTIVE membership in the active company, so an account created without one cannot be given a
  key.
- The endpoint SHALL never accept or set a password. A service account has no `password_hash`,
  and interactive login SHALL reject it explicitly — not merely as a side effect of the missing
  hash.
- A **New service account** action in the RBAC admin Users tab, gated on `RBAC_MANAGE`, with a
  Zod schema mirroring the DTO.
- Service accounts are visually distinguishable from people in the Users list, and are never
  offered password reset or email-verification actions.
- Service accounts are excluded from the employee link-account picker — they are not people to
  attach to an employee record. **BREAKING** for that read's result set: an operator who had
  linked a bot account to an employee will no longer see such accounts offered.
- `setup-claim-dev.ts` keeps working. This is an additional supported path, not a replacement.

### A constraint that shapes the design

`app_user.email` is **NOT NULL and unique** in both the DBML (line 178) and the entity, so a
service account cannot simply omit an email. The change therefore requires an email like
`claim-bot@hal.local` (what the script already does) rather than making the column nullable —
relaxing a NOT NULL on the identity table is a far larger blast radius than this feature earns.

## Capabilities

### New Capabilities

None. This extends an existing identity model rather than introducing a capability.

### Modified Capabilities

- `rbac`: adds the service-account identity, its creation rule (no password, ever; membership
  granted atomically), an explicit interactive-login denial, and the exclusion of service
  accounts from the employee linkable-account read. Existing role, permission, scope, and
  membership machinery is reused unchanged — this adds an identity **type**, not a new
  authorization model.
- `web-rbac-admin`: adds the create-service-account affordance to the Users tab, its permission
  gate, the visual distinction from human users, and the suppression of person-only actions.

`external-api` needs no delta. Its issuance rule already says the target user must belong to the
active company; a service account created with its membership satisfies that rule as written, so
no requirement changes — only the set of users that happens to qualify.

## Impact

**Data model.** One added flag on `app_user`, so `erp_approval_system.dbml` and a migration are
in scope. Existing rows backfill to "not a service account", which is correct for every account
that exists today. No column is dropped and no NOT NULL is relaxed.

**Backend** (`back/src/modules/rbac/`) — a create-service-account DTO, service method, and
`RBAC_MANAGE`-guarded route; an explicit denial in `rbac-auth.service.ts` (which today rejects a
passwordless user only implicitly, via `!!user.passwordHash`); exclusion of service accounts
from `listLinkableAccounts()`; and the entity + migration.

**Frontend** (`front-end/src/views/admin/RbacAdminView.vue`, its store and API client) — the new
dialog, the list badge, and the hiding of person-only row actions.

**Shared** (`shared/`) — one Zod schema mirroring the DTO, per the single-source-of-truth rule.

**Invariants.** Company isolation holds: the membership is created in the active company from
request context, never from the request body, exactly as employee onboarding does. Permission
codes remain the authorization currency (invariant 5) — a service account is authorized by the
same codes as any other principal. Nothing here writes an append-only ledger, reserves budget or
quota, issues a document number, or touches FX, so no transaction boundary or pessimistic lock
is introduced.

**Security.** The net effect is a reduction in privilege: today the only UI-creatable bot has a
password and can sign in; afterwards it cannot. `ApiKeyDenyGuard` is unaffected — it blocks
API-key sessions from specific endpoints and does not care how the bound user was created.
