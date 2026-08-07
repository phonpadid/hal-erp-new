## 1. Data model

- [x] 1.1 Add `is_service_account boolean [not null, default: false]` to `Table app_user` in `erp_approval_system.dbml`, with a note that it marks a non-human identity authenticated only by API key
- [x] 1.2 Add `isServiceAccount: boolean = false` with `@Property({ default: false })` to `AppUser` in `back/src/modules/rbac/rbac.entities.ts`
- [x] 1.3 Generate the additive migration (new column, `not null default false`, no backfill — the default is correct for every existing row) and verify the MikroORM snapshot matches the entities afterwards

## 2. Backend: create a service account

- [x] 2.1 Add `CreateServiceAccountDto` in `back/src/modules/rbac/dto/` — `username` (`@IsString`, `@MaxLength(255)`), `email` (`@IsEmail`, `@MaxLength(255)`), `roleId` (`@IsUUID`), `departmentId` (`@IsUUID`); assert by review that the DTO exposes **no** password field
- [x] 2.2 Add `createServiceAccount()` to the RBAC service, modelled on `EmployeeService.onboard()`: company from `RequestContext.companyId()` (never the body), `role`/`department` validated against that company, account + `user_company_role` created inside one `em.transactional(...)`
- [x] 2.3 Set `isServiceAccount: true`, `emailVerifiedAt: new Date()`, `status: 'ACTIVE'`, and leave `passwordHash` undefined — do not read `USER_PASSWORD` on this path
- [x] 2.4 Reject a duplicate `username` or `email` with a clear message (the unique constraints exist; surface them rather than leaking a constraint-violation error)
- [x] 2.5 Send no verification email on this path
- [x] 2.6 Expose the route on the RBAC controller guarded by `RBAC_MANAGE`, returning the created account without `passwordHash` (the entity's `hidden` already excludes it — confirm in the response)

## 3. Backend: deny interactive login and hide from the linkable picker

- [x] 3.1 In `back/src/modules/rbac/rbac-auth.service.ts`, deny a service account explicitly (alongside the existing `!!user.passwordHash` check) with the same generic invalid-credentials outcome — not a distinct one, so service accounts cannot be enumerated
- [x] 3.2 In `EmployeeService.listLinkableAccounts()`, exclude service accounts from the `where` regardless of link state
- [x] 3.3 Confirm `ApiKeyService.eligibleUsers()` needs no change — a service account created with its membership already qualifies under the existing ACTIVE-membership rule

## 4. Backend tests

- [x] 4.1 Creating a service account yields an account with the marker set, no `password_hash`, `emailVerifiedAt` set, and a `user_company_role` in the active company
- [x] 4.2 The creation is atomic: when the assignment write fails, no account row remains
- [x] 4.3 A `roleId` or `departmentId` from another company is rejected and nothing is created (company isolation under the new path)
- [x] 4.4 A duplicate `username` and a duplicate `email` are each rejected
- [x] 4.5 The route rejects a caller without `RBAC_MANAGE`
- [x] 4.6 Interactive login is denied for a service account, and the outcome is byte-identical to a wrong-password attempt against a human account (no enumeration)
- [x] 4.7 API-key authentication still resolves a service account to the bound principal with its permission codes
- [x] 4.8 `listLinkableAccounts()` never returns a service account, with and without a search term matching its username
- [x] 4.9 A service account is an eligible API-key target immediately after creation
- [x] 4.10 A human account with no `password_hash` is NOT reported as a service account (the marker, not the inference)

## 5. Shared schema

- [x] 5.1 Add `createServiceAccountSchema` to `shared/`, mirroring `CreateServiceAccountDto` field for field, and export it
- [x] 5.2 Add a test asserting the schema accepts a valid payload and rejects a missing username, a malformed email, and a non-UUID role or department

## 6. Frontend

- [x] 6.1 Add the API client call and store action for creating a service account, reloading the user list once on success
- [x] 6.2 Surface `isServiceAccount` on the user rows the RBAC admin reads
- [x] 6.3 Add a "New service account" action to the Users tab of `RbacAdminView.vue`, gated on `RBAC_MANAGE`, opening a dialog with username, email, department, and role — and no password field
- [x] 6.4 Validate with `createServiceAccountSchema` via `zodResolver`, showing per-field errors in the established `<Message v-if="$form.<field>?.invalid">` form
- [x] 6.5 Render a Tag on service-account rows in the Users list so they are distinguishable from people, using theme tokens only
- [x] 6.6 Hide password-reset and email-verification affordances for service-account rows — no code needed: the RBAC admin offers neither (its row actions are assign / view-across / revoke), and the only email-verification toggle lives on the employee screen, which a service account can never reach (no employee record, and excluded from the linkable picker by 3.2)
- [x] 6.7 Add i18n keys for every new label, action, and error in all three locales (Lao, English, Chinese)

## 7. Converge the script and verify

- [x] 7.1 DEVIATION: set `isServiceAccount: true` in `setup-claim-dev.ts` rather than routing it through `createServiceAccount()`. The script guards the account and its membership as SEPARATE idempotent steps so a re-run repairs a bot whose membership is missing; the service creates both atomically and would raise a Conflict instead. Swapping it in would have traded working idempotency for uniformity. Both paths now produce the identical shape (marked, passwordless, pre-verified)
- [x] 7.2 DECIDED: the migration does NOT backfill — inferring identity kind from a null password_hash is the exact guess this column replaces. Existing `claim-bot` rows stay `false` until an operator runs a deliberate one-row update per environment: `update app_user set is_service_account = true where username = 'claim-bot';`. Until then such a bot keeps working (API-key auth never reads the flag) but is not badged and is still offered in the employee linkable-account picker
- [x] 7.3 Add a frontend store/schema test covering the create action and the service-account badge
- [x] 7.4 Run the backend suite, `nest build`, the frontend `ci` script (typecheck + tests), and confirm they pass
- [ ] 7.5 Manually verify end to end: create a service account in the UI, confirm it is badged and offers no person-only actions, issue it an API key from the API-keys screen, confirm the key authenticates, and confirm the account cannot log in through the web login form
