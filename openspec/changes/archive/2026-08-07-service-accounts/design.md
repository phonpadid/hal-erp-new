## Context

`AppUser` already tolerates a passwordless account: `passwordHash` is `@Property({ nullable: true, hidden: true })` and `rbac-auth.service.ts:61-68` requires `!!user.passwordHash` before verifying, so an account with no hash cannot pass login. The `claim-bot` the HAL claim integration authenticates as is exactly that shape, but it exists only because `back/scripts/setup-claim-dev.ts` creates it directly against the database.

The product has no other way to get there. Searching the front-end turns up no create-user screen at all: `RbacAdminView.vue`'s Users tab renders assign / view-across-companies / revoke and nothing else. The only endpoints that create an `app_user` are `POST /employees/:id/create-account` and `POST /employees/:id/onboard`, both of which require an `employee` row and both of which hash `process.env.USER_PASSWORD` into the new account (`employee.service.ts:366-370`).

`onboard` is nonetheless the right shape to copy for everything except the password: it takes the company from `RequestContext`, validates `roleId`/`departmentId` against that company, and creates the account plus its `user_company_role` inside one `em.transactional(...)`.

Ordering matters downstream. `ApiKeyService.eligibleUsers()` lists only users with an ACTIVE membership in the active company, so an account created without a membership is invisible to the API-key screen — the credential the service account exists to hold could not be issued to it.

## Goals / Non-Goals

**Goals:**
- Make a service account creatable and administrable through the UI, by an `RBAC_MANAGE` holder, without inventing an employee.
- Guarantee a service account cannot obtain an interactive session, by an explicit rule rather than an accident of a null column.
- Land the account already able to receive an API key — created with its first company-role assignment in the same call.
- Keep the authorization model untouched: same permission codes, same scopes, same membership table.

**Non-Goals:**
- No new authentication mechanism. API keys already exist and already resolve to the bound principal; this only changes what kind of principal may be bound.
- No key issuance from the service-account dialog. Creating the identity and issuing its credential stay separate screens with separate permissions (`RBAC_MANAGE` vs `API_KEY_MANAGE`) — that separation is a control, not an oversight.
- No conversion either way between a person and a service account.
- No relaxation of `app_user.email`'s NOT NULL/unique constraint.
- No change to `setup-claim-dev.ts`, which must keep working.
- No per-service-account rate limiting, IP allow-listing, or key rotation policy.

## Decisions

**An explicit `is_service_account` flag on `app_user`, not inference from a null `password_hash`.** Inference is the cheaper option and is rejected. A human whose account was created before a password was set, or whose hash is cleared by some future reset flow, is byte-for-byte indistinguishable from a bot under that rule — so the UI badge would lie and, far worse, the login denial would key off a condition that a human can transiently enter. An identity kind is a fact about the account, so it is stored as one. Existing rows backfill to `false`, which is correct for every account that exists today.

**Email is required, synthetic if necessary.** `app_user.email` is `unique, not null` in the DBML (line 178) and `@Property({ unique: true })` in the entity. The alternative — making it nullable — was considered and rejected: it relaxes a constraint on the identity table for every account in the system to serve one identity kind, and it would silently weaken the uniqueness guarantee other flows rely on. The endpoint therefore requires an email and the admin supplies something like `claim-bot@hal.local`, which is what the script already does. The email is never mailed to.

**Login denies service accounts explicitly.** `rbac-auth.service.ts` gains a check on the flag that fails with the same generic "invalid credentials" outcome as a bad password. Two reasons this is not redundant with the missing hash: it survives any future change to how hashes are managed, and it is testable as an intent ("a service account may not sign in") rather than as a side effect. It deliberately does **not** return a distinct "this is a bot" outcome — that would let an unauthenticated caller enumerate which usernames are service accounts. This differs from the existing unverified-email path, which is distinct on purpose because the user needs to be told to go verify; nobody needs to be told a bot is a bot.

**Creation and first membership in one `em.transactional(...)`, copying `onboard`.** The company comes from `RequestContext.companyId()`, never the body (invariant 1); `roleId` and `departmentId` are validated as belonging to that company before use, so no cross-company grant is reachable. A half-created service account with no membership would be an account that can neither log in nor hold a key — inert but confusing — so the two writes commit together or not at all.

**`emailVerifiedAt` is stamped at creation.** The script already does this. It costs nothing, keeps the account out of any "unverified" reporting, and cannot be used to log in because the flag check and the missing hash both bar the door. The alternative — leaving it null — would make the account permanently appear as a pending human in any admin view that surfaces verification state.

**Service accounts are excluded from `listLinkableAccounts()`.** That read exists so an employee admin can attach a *person's* login to their employee record. A bot in that picker is an invitation to create exactly the fake-employee mess this change removes. This narrows an existing read's result set, which is why the proposal marks it BREAKING; in practice it can only remove rows that should never have been offered.

**The UI badge and the suppressed actions are driven by the flag, not by a heuristic.** The Users list renders a tag for service accounts, and password-reset / email-verification affordances are hidden for them. Client-side gating is UX only, as everywhere else — the server denial is what actually holds.

**No `external-api` change.** Its issuance rule already requires the target to be a member of the active company. A service account created with its membership satisfies that rule unchanged, so the set of eligible users grows without the requirement moving.

## Risks / Trade-offs

- **A new column on the identity table touches every account.** → It is additive and defaulted (`false`), so existing rows are correct without a data backfill step. `erp_approval_system.dbml` is updated in the same change so the model and the schema do not drift.
- **An admin could create a service account and forget to issue it a key**, leaving an identity that does nothing. → Harmless (it cannot authenticate at all) and visible: it appears in the Users list badged as a service account with its role assignment shown.
- **A service account is a standing principal with real permissions and no human owner.** → This change does not make that worse — `claim-bot` already exists with `DOC_CREATE`/`DOC_SUBMIT`/`DOC_VIEW`/`DOC_CANCEL` — but it does make such accounts easier to create. Mitigation: creation stays behind `RBAC_MANAGE`, the account is badged in the Users list rather than hidden among people, and its grants are administered through the same role screen with the same scope rules as any user. Key expiry and revocation remain `external-api`'s job.
- **The BREAKING exclusion from the linkable-account picker.** → Only service accounts disappear from it. An operator who genuinely linked a bot to an employee row was papering over the gap this change closes; that existing link is not deleted, merely no longer offered again.
- **Two creation paths now exist (script and UI) and could drift.** → The script keeps working by design, but it should end up producing an account the UI would also produce. The tasks include pointing the script at the same service method so there is one implementation of "what a service account is".

## Migration Plan

One additive migration adds `app_user.is_service_account boolean not null default false`, and `erp_approval_system.dbml` is updated to match. No backfill script: the default is the correct value for every existing row. Deploy is backend-then-frontend; the new column and endpoint are additive, so a current frontend against the new backend is unaffected, and the new UI degrades to a failing call against an old backend rather than misbehaving. Rollback is the down migration plus a revert — nothing outside the new column and route persists new state.

`claim-bot` in existing environments keeps working untouched: it authenticates by API key, which resolves through the bound principal and never consults the new flag. Optionally its row can be flagged `true` afterwards so the UI badges it correctly; that is a one-row update, not a requirement of this change.

## Open Questions

- Should an existing passwordless account like `claim-bot` be flagged `is_service_account = true` as part of this migration, or left for an operator to do per environment? Flagging it automatically would mean the migration guesses identity kind from a null hash — the exact inference this design rejects — so the current plan leaves it out. Worth revisiting if more than a handful of environments are affected.
- Should a service account be deletable or deactivatable from the RBAC admin, or is revoking its API key and its role assignment sufficient? Deferred: `status` on `app_user` already exists and is checked at API-key resolution, so the capability is present even though no screen exposes it for this identity kind yet.
