# RBAC Specification

## Purpose
Single sign-on across the group, with per-company roles, permission-code-driven
authorization, and data scopes. One user account, many company identities.
## Requirements
### Requirement: Single Login, Multiple Company Contexts
The system SHALL authenticate a user once against `app_user`, then resolve the
companies they may access via `user_company_role`.

#### Scenario: Login resolves accessible companies
- GIVEN a user assigned roles in company A and company B
- WHEN the user authenticates successfully
- THEN the system presents both companies for selection
- AND enters the company marked `is_default` automatically if one exists

### Requirement: Company Context Token
The system SHALL issue an access token bound to the selected company, embedding the
`company_id`, `department_id`, and the resolved permission codes with their scope.

#### Scenario: Switching company re-issues context
- GIVEN an active session in company A
- WHEN the user switches to company B
- THEN a new token MUST be issued for company B
- AND permissions from company A MUST NOT apply to company B requests

### Requirement: Permission-Code Authorization
The system SHALL authorize actions by permission code (e.g. `DOC_PR_APPROVE`),
never by role name. Roles are per-company and MAY share names across companies.

#### Scenario: Same role name, different permissions
- GIVEN company A role "Manager" maps to `DOC_PR_APPROVE`
- AND company B role "Manager" does NOT
- WHEN the same user acts as Manager in company B
- THEN the system MUST deny `DOC_PR_APPROVE` in company B

### Requirement: Data Scope Enforcement
Each granted permission SHALL carry a scope of OWN, DEPARTMENT, COMPANY, or GROUP.
Every data query MUST filter by the active company first, then by scope.

#### Scenario: Department scope limits visibility
- GIVEN a user with `DOC_VIEW` at DEPARTMENT scope
- WHEN they list documents
- THEN only documents of their department in the active company are returned
- AND GROUP scope is the only scope that MAY read across companies (read-only)

### Requirement: Time-Bounded Grants
The system SHALL support `valid_from`/`valid_to` on role assignments for temporary
or acting authority.

#### Scenario: Expired grant is ignored
- GIVEN a role assignment whose `valid_to` is in the past
- WHEN the user selects that company
- THEN the expired assignment MUST NOT contribute any permissions

### Requirement: Resignation Affects One Company Only
When an employee resigns from one company, the system SHALL deactivate only that
company's `user_company_role`, not the shared `app_user` account.

#### Scenario: Resigning from A keeps B access
- GIVEN a user active in company A and company B
- WHEN a resignation post-action runs for company A
- THEN the user's company A access is revoked
- AND the user can still log in and access company B

### Requirement: Credential Verification

The system SHALL store user credentials only as a one-way hash in
`app_user.password_hash` and SHALL verify a login by comparing the presented password
against that hash — plaintext passwords MUST NOT be stored or logged. A user whose
`app_user.status` is not `ACTIVE` MUST be denied authentication regardless of password.

#### Scenario: Correct password for an active user authenticates

- **WHEN** an `ACTIVE` user submits the password whose hash is stored
- **THEN** authentication succeeds and company resolution proceeds

#### Scenario: Wrong password is rejected

- **WHEN** a user submits a password that does not match the stored hash
- **THEN** authentication fails with an unauthorized error and no token is issued

#### Scenario: Inactive account cannot authenticate

- **WHEN** a user whose `status` is not `ACTIVE` submits the correct password
- **THEN** authentication fails

### Requirement: Authentication API

The system SHALL expose `POST /auth/login` (username + password) returning the
companies the user may enter and, when an `is_default` membership exists, a
company-context token; `POST /auth/switch-company` (authenticated) which re-issues a
token for another company the user belongs to; and `GET /auth/me` returning the current
resolved context. Switching to a company the user has no active membership in MUST be
rejected.

The resolved context returned by `GET /auth/me` SHALL include `hasSignature`: whether the
user's `app_user.current_signature_id` is set. It is a fact about the account, not the company,
so it SHALL read the same in every company context. It exists so a client can decide, at the
moment it draws them, whether the affordances that end in a stamped signature (submit, approve)
are available, without a second request; the server still enforces on the action itself.

#### Scenario: Login returns a token for the default company

- **WHEN** a user with a default membership logs in with valid credentials
- **THEN** the response includes a token bound to that company and the list of
  accessible companies

#### Scenario: Login without a default returns companies for selection

- **WHEN** a user with memberships but no `is_default` logs in
- **THEN** the response lists the accessible companies and issues no context token until
  one is selected

#### Scenario: Switching to an unauthorized company is rejected

- **WHEN** an authenticated user requests a token for a company they have no active
  membership in
- **THEN** the request is rejected and no token is issued

#### Scenario: The context says whether a signature is on file

- **GIVEN** a user whose `current_signature_id` is set
- **WHEN** they call `GET /auth/me`
- **THEN** the response carries `hasSignature: true`, and `false` for a user with none

### Requirement: Permission Aggregation

When resolving a user's permissions for the active company, the system SHALL union the
permission codes granted by all of the user's active roles in that company. A code
granted at more than one scope SHALL resolve to the **broadest** scope
(GROUP > COMPANY > DEPARTMENT > OWN). Only permissions from active (non-expired) roles
and active `permission` rows SHALL be included.

#### Scenario: Broadest scope wins on conflict

- **GIVEN** one role grants `DOC_VIEW` at DEPARTMENT scope and another grants `DOC_VIEW`
  at COMPANY scope to the same user in the same company
- **WHEN** permissions are resolved
- **THEN** the token carries `DOC_VIEW` once, at COMPANY scope

#### Scenario: Inactive permission is excluded

- **WHEN** a role references a `permission` whose `is_active` is false
- **THEN** that code is omitted from the resolved set

### Requirement: Authorization Read Surface

The system SHALL provide reads, under `RBAC_MANAGE` and scoped to the active company, of: the
company's roles each with their permission grants (`code`, `name`, `scope`); the permission
catalog (`code`, `name`, `module`); and users with their active-company assignments (role,
department, default flag, validity window). User accounts are global; assignments are
company-scoped.

The permission-catalog read SHALL additionally report the declared codes that have no row, so that
an administrator can tell a catalog that is complete from one that is short. A code with no row
cannot be granted to anyone, so its absence is not a detail of the listing — it is the reason a
capability is unreachable for every user in the installation, including an administrator holding
every code the catalog does offer.

#### Scenario: Roles include their grants

- **WHEN** an `RBAC_MANAGE` user lists roles
- **THEN** each active-company role is returned with its granted permission codes and scopes

#### Scenario: Users include their active-company assignments

- **WHEN** an `RBAC_MANAGE` user lists users
- **THEN** each user's assignments in the active company are returned (and not those of other
  companies)

#### Scenario: The catalog read names what it cannot offer

- **GIVEN** an environment whose `permission` table is short of declared codes
- **WHEN** an `RBAC_MANAGE` user reads the permission catalog
- **THEN** the response carries those declared-but-absent codes, distinct from the codes it lists
  as grantable

#### Scenario: A complete catalog reports nothing absent

- **GIVEN** an environment whose catalog holds a row for every declared code
- **WHEN** an `RBAC_MANAGE` user reads the permission catalog
- **THEN** the response reports no absent codes

### Requirement: Linkable Account Read For Employee Admin

The system SHALL provide a read, guarded by `EMPLOYEE_MANAGE`, that returns login accounts
(`app_user`) which are **not yet linked to any employee**, so an employee admin can pick an existing
account to link without knowing its `app_user` id. Each returned account SHALL include `id`,
`username`, and `email`, and SHALL NOT include any per-company role assignment. The read SHALL
support an optional case-insensitive search over `username` and `email`. Because `app_user` is
global and each account may be linked to at most one employee, "not yet linked" means linked to no
employee in any company; an account already linked to an employee SHALL be excluded.

Service accounts SHALL be excluded from this read regardless of their link state. The read exists
so an admin can attach a **person's** login to their employee record; a non-human identity offered
there invites a fake employee record for something that is not a person.

#### Scenario: List returns only unlinked accounts

- **WHEN** an `EMPLOYEE_MANAGE` user reads the linkable accounts
- **THEN** every account that is already linked to some employee is excluded, and each returned
  account carries its `id`, `username`, and `email` but no role assignments

#### Scenario: Search narrows by username or email

- **WHEN** the user reads linkable accounts with a search term
- **THEN** only unlinked accounts whose `username` or `email` matches the term (case-insensitive)
  are returned

#### Scenario: Permission is EMPLOYEE_MANAGE, not RBAC_MANAGE

- **WHEN** a user holding `EMPLOYEE_MANAGE` but not `RBAC_MANAGE` reads the linkable accounts
- **THEN** the read succeeds, so linking an account is available to every employee admin

#### Scenario: Service accounts are never offered for linking

- **GIVEN** an unlinked service account
- **WHEN** an `EMPLOYEE_MANAGE` user reads the linkable accounts, with or without a search term that matches its username
- **THEN** the service account is not returned

### Requirement: Fine-Grained Revocation

The system SHALL let an `RBAC_MANAGE` user detach a single permission grant from a role and remove
a single user-role assignment, in addition to the existing bulk company-access revoke. Detaching a
grant or removing an assignment SHALL affect only the active company's role/assignment.

#### Scenario: Detach one grant

- **WHEN** an `RBAC_MANAGE` user detaches a permission from a role
- **THEN** that role-permission grant is removed and the role's other grants are unchanged

#### Scenario: Remove one assignment

- **WHEN** an `RBAC_MANAGE` user removes a single assignment
- **THEN** that assignment is removed and the user's other assignments are unchanged

### Requirement: Bulk Role-Permission Writes

The system SHALL provide an `RBAC_MANAGE`-gated write surface that applies a batch of
`role_permission` changes for one `role` in a single request. A batch SHALL carry, for that
role, the set of permission codes to grant (each with a data-visibility `scope` of
`OWN`/`DEPARTMENT`/`COMPANY`/`GROUP`) and the set of permission codes to detach.

The whole batch SHALL be applied inside one database transaction: either every item takes
effect or none does. The batch SHALL be validated in full **before** any row is written —
if any item names an unknown `permission.code`, an invalid `scope`, or a `role` outside the
requester's active company, the entire batch SHALL be rejected and no `role_permission` row
SHALL be created, updated, or deleted.

Within a batch, an item that is already satisfied SHALL NOT be an error. Granting a
permission the role already holds **with the same scope** SHALL be reported as skipped;
granting one the role already holds **with a different scope** SHALL update that grant's
`scope` (the `(role_id, permission_id)` pair stays unique — a second row SHALL NOT be
inserted); detaching a permission the role does not hold SHALL be reported as skipped. The
response SHALL report per-item outcomes so the caller can distinguish applied from skipped
work. The existing single-item grant endpoint SHALL keep rejecting a duplicate grant with a
conflict.

#### Scenario: Grant many permissions in one request

- **WHEN** an `RBAC_MANAGE` user submits a batch granting several permission codes to a role
  in the active company
- **THEN** one `role_permission` row exists per code with the submitted `scope`, and the
  response reports each item as applied

#### Scenario: Batch mixes grants and detaches

- **GIVEN** a role that holds permissions A and B
- **WHEN** a batch grants C and D and detaches A
- **THEN** the role holds B, C, and D, and no longer holds A

#### Scenario: Re-granting a held permission with the same scope is skipped, not fatal

- **GIVEN** a role that already holds permission A with scope `DEPARTMENT`
- **WHEN** a batch grants A with scope `DEPARTMENT` alongside a new permission B
- **THEN** B is granted, A is reported as skipped, and the request succeeds

#### Scenario: Re-granting a held permission with a new scope updates it in place

- **GIVEN** a role that already holds permission A with scope `DEPARTMENT`
- **WHEN** a batch grants A with scope `COMPANY`
- **THEN** the existing `role_permission` row's `scope` becomes `COMPANY` and no second row
  for that `(role_id, permission_id)` pair is inserted

#### Scenario: An invalid item rejects the whole batch

- **WHEN** a batch contains one unknown permission code among otherwise valid items
- **THEN** the request is rejected and none of the batch's grants or detaches are applied

#### Scenario: A role outside the active company is rejected

- **WHEN** an `RBAC_MANAGE` user submits a batch naming a `role` belonging to another company
- **THEN** the request is rejected and no `role_permission` row is written

### Requirement: Bulk User Role Assignment Writes

The system SHALL provide an `RBAC_MANAGE`-gated write surface that assigns several roles to
one user in a single request against a shared context: one `department_id`, an optional
default flag, and an optional validity window (`valid_from`/`valid_to`). The system SHALL
create one `user_company_role` row per named role, all carrying that shared context and the
requester's active `company_id`.

The whole batch SHALL be applied inside one database transaction, validated in full before
any row is written. If any named `role` or the `department` does not belong to the active
company, or the window's `valid_to` precedes its `valid_from`, the entire batch SHALL be
rejected and no `user_company_role` row SHALL be created.

Because `user_company_role` is unique on `(user_id, company_id, role_id)`, a role the user
already holds in the active company SHALL be reported as skipped rather than failing the
batch. Because `is_default` marks the company a user enters at login, the batch's default
flag is part of its shared context and SHALL be applied to **at most one** of the
assignments the batch creates; the remaining assignments SHALL be created with
`is_default = false`.

#### Scenario: Assign several roles in one request

- **WHEN** an `RBAC_MANAGE` user submits a batch assigning three roles to a user with one
  department and no window
- **THEN** three `user_company_role` rows exist for that user in the active company, each
  with that `department_id`

#### Scenario: Shared acting window applies to every role in the batch

- **WHEN** a batch assigns two roles with `valid_from` and `valid_to` set
- **THEN** both created assignments carry that same validity window

#### Scenario: An already-held role is skipped, not fatal

- **GIVEN** a user who already holds role A in the active company
- **WHEN** a batch assigns roles A and B
- **THEN** B is assigned, A is reported as skipped, and the request succeeds

#### Scenario: The default flag lands on exactly one assignment

- **WHEN** a batch assigns three roles with its shared default flag set
- **THEN** exactly one of the created assignments has `is_default = true` and the other two
  have `is_default = false`

#### Scenario: A department outside the active company rejects the whole batch

- **WHEN** a batch names a `department` belonging to another company
- **THEN** the request is rejected and no `user_company_role` row is created

#### Scenario: An invalid window rejects the whole batch

- **WHEN** a batch carries a `valid_to` earlier than its `valid_from`
- **THEN** the request is rejected and no `user_company_role` row is created

### Requirement: Cross-Company Assignment Read

The system SHALL provide a read-only surface that, given a `userId`, returns that user's **active**
`user_company_role` assignments across companies — but only those companies in which the requester
holds `RBAC_MANAGE`. The result SHALL include, per assignment, the company, role, department, and
validity window (`valid_from`/`valid_to`). This surface SHALL NOT permit any write and SHALL NOT
return assignments in companies the requester is not authorized to administer.

#### Scenario: Requester sees only companies they administer

- **GIVEN** a target user with active assignments in companies A, B, and C
- **AND** a requester who holds `RBAC_MANAGE` in companies A and B only
- **WHEN** the requester reads the target user's cross-company assignments
- **THEN** assignments in A and B are returned and the assignment in C is omitted

#### Scenario: Only active assignments are returned

- **WHEN** the cross-company read runs for a user whose company A assignment has a past `valid_to`
- **THEN** that expired assignment is excluded from the result

#### Scenario: Read surface performs no writes

- **WHEN** the cross-company read is invoked
- **THEN** no `user_company_role`, `app_user`, or other row is created, updated, or deleted

### Requirement: Create Login Account With Server-Side Initial Password

The system SHALL allow an authorized administrator to create an `app_user` login account by
supplying only a `username` and `email`. The account's initial password SHALL be taken from the
`USER_PASSWORD` server environment variable and stored only as a one-way hash; the administrator
SHALL NOT supply a password. New accounts SHALL be created with status `ACTIVE`. The system SHALL
enforce uniqueness of `username` and `email`, and SHALL refuse to create an account when
`USER_PASSWORD` is not configured.

#### Scenario: Account created with hashed initial password

- **WHEN** an authorized admin creates an account with a unique `username` and `email` and
  `USER_PASSWORD` is configured
- **THEN** an `app_user` is created with status `ACTIVE` and `password_hash` set to the hash of
  `USER_PASSWORD`, and no plaintext password is stored or returned

#### Scenario: Initial password authenticates

- **WHEN** the newly created user logs in with the value of `USER_PASSWORD`
- **THEN** authentication succeeds (the stored hash verifies against `USER_PASSWORD`)

#### Scenario: Duplicate username or email is rejected

- **WHEN** the admin creates an account whose `username` or `email` already belongs to another
  `app_user`
- **THEN** the request is rejected and no new account is created

#### Scenario: Missing USER_PASSWORD fails closed

- **WHEN** the admin attempts to create an account while `USER_PASSWORD` is unset or empty
- **THEN** the request is rejected and no account is created (no default or empty password is used)

### Requirement: Onboard an Employee Account With First Company Access

The system SHALL provide an action, guarded by **both** `EMPLOYEE_MANAGE` and `RBAC_MANAGE`, that in a
single atomic transaction (1) creates an `app_user` login account, (2) links it to the target employee, and
(3) creates a `user_company_role` granting that user a role in the **active company**. The company SHALL be
taken from the request context, never from the request body. The admin supplies `username`, `email`, `roleId`,
and `departmentId` (and optional validity window); the department MUST belong to the active company, defaulting
to the employee's own department. As with account creation, the admin SHALL NOT enter a password — the initial
password is read server-side from `USER_PASSWORD` and stored only as a one-way hash, and the account is created
`ACTIVE`. The created `user_company_role` SHALL be marked **default** (`isDefault = true`) so the user's next
login auto-selects that company and receives a company-context token. The action SHALL be rejected when the
employee already has a linked account, when `username`/`email` collide with an existing account, when the role
or department does not belong to the active company, or when `USER_PASSWORD` is not configured; on any rejection
no account, link, or membership SHALL be persisted.

#### Scenario: Onboarding creates account, link, and a default membership atomically

- **WHEN** an admin holding both `EMPLOYEE_MANAGE` and `RBAC_MANAGE` onboards an employee with a valid
  `username`, `email`, `roleId`, and `departmentId`
- **THEN** a new `ACTIVE` `app_user` is created and linked to the employee, and a `user_company_role` is created
  in the active company with `isDefault = true`, all in one transaction

#### Scenario: Onboarded user can log in immediately with a token

- **WHEN** the onboarded user next authenticates
- **THEN** the login resolves the granted company as their default and issues a company-context access token
  (no empty-companies / null-token state)

#### Scenario: Requires both permissions

- **WHEN** a user holding only one of `EMPLOYEE_MANAGE` or `RBAC_MANAGE` attempts to onboard
- **THEN** the request is rejected and no account or membership is created

#### Scenario: Company is the active company, not the body

- **WHEN** the onboarding request is made while the admin's active company is company A
- **THEN** the `user_company_role` is created in company A regardless of any company value in the payload

#### Scenario: Rejection is atomic

- **WHEN** onboarding fails because the employee already has an account, the username/email collide, the role or
  department is not in the active company, or `USER_PASSWORD` is unset
- **THEN** no `app_user`, employee link, or `user_company_role` is persisted

### Requirement: Email Verification State On Accounts

The system SHALL track per-account email-verification state on `app_user` via a nullable
`email_verified_at` timestamp (null = unverified; non-null = the instant the email was confirmed). This
state SHALL be independent of `status` (ACTIVE/RESIGNED) — a newly created account is `ACTIVE` yet
unverified. Verification SHALL be recorded with a single-use, time-limited token whose **hash only** is
persisted (the raw token exists only in the emailed link), following the same custody rules as the
password-reset token.

#### Scenario: New account starts unverified

- **WHEN** an account is created
- **THEN** its `email_verified_at` is null (unverified) while its `status` is `ACTIVE`

#### Scenario: Only the token hash is stored

- **WHEN** a verification token is issued
- **THEN** only its hash is persisted, with an expiry and a single-use marker; the raw token appears only
  in the emailed link

### Requirement: Verification Email On Account Creation

The system SHALL issue a verification token and send a verification email whenever an account is created,
both via create-and-link (create-account) and via onboarding (onboard). The email SHALL contain a link to
the public verify page carrying the raw token, reusing the existing email transport. Email delivery SHALL be
best-effort: when SMTP is not configured (dev/test) the send is a no-op and account creation still succeeds.

#### Scenario: Creation sends a verification link

- **WHEN** an admin creates or onboards an account
- **THEN** a verification token is issued and a verification email with the link is sent to the account's
  email

#### Scenario: Creation succeeds even if mail cannot be sent

- **WHEN** SMTP is unconfigured and an account is created
- **THEN** the account is still created (unverified) and no error is surfaced from the email step

### Requirement: Confirm Email With A Token

The system SHALL provide a public endpoint that, given a valid unconsumed unexpired token, marks the
account's email verified (sets `email_verified_at`) and consumes the token (single-use). An invalid,
expired, or already-consumed token SHALL be rejected without changing any account.

#### Scenario: Valid token verifies the account

- **WHEN** the verify endpoint is called with a valid token
- **THEN** the account's `email_verified_at` is set and the token is consumed so it cannot be reused

#### Scenario: Invalid or expired token is rejected

- **WHEN** the verify endpoint is called with an invalid, expired, or already-consumed token
- **THEN** the request is rejected and no account is modified

### Requirement: Login Requires A Verified Email

Authentication SHALL deny a user whose email is not verified, with an outcome distinct from invalid
credentials so the client can prompt the user to verify. Password validity and `status = ACTIVE` are
checked as before; an unverified but otherwise valid account SHALL NOT receive an access token or company
list.

#### Scenario: Unverified account cannot log in

- **WHEN** a user with a correct password and `ACTIVE` status but null `email_verified_at` authenticates
- **THEN** login is denied with a distinct "email not verified" outcome and no token is issued

#### Scenario: Verified account logs in normally

- **WHEN** the same user authenticates after their email is verified
- **THEN** login proceeds as usual (resolving companies and, when a default exists, a token)

### Requirement: Admin May Mark An Account Verified

The system SHALL let an `EMPLOYEE_MANAGE` admin mark an employee's linked account verified **without**
sending or requiring an email, as an escape hatch when mail cannot be delivered. This action SHALL set
`email_verified_at` if not already set and SHALL be idempotent; it SHALL NOT un-verify an account and SHALL
NOT be available for an employee that has no linked account.

#### Scenario: Admin verifies an account manually

- **WHEN** an `EMPLOYEE_MANAGE` admin marks a linked, unverified account verified
- **THEN** the account's `email_verified_at` is set and the user can log in, with no email involved

#### Scenario: Manual verify is idempotent and one-way

- **WHEN** an admin marks an already-verified account verified again
- **THEN** the account stays verified (the original verification time is unchanged) and the action cannot
  clear verification

### Requirement: API Key Management Permission

The RBAC permission master SHALL include a permission code `API_KEY_MANAGE` that authorizes
issuing, listing, and revoking API keys within the active company. Authorization for API-key
management endpoints SHALL check this code, never a role name, consistent with permission-code
authorization. Issuing a key SHALL NOT grant the bound user any authority beyond the grants
already resolved for that user in that company.

#### Scenario: Management endpoints authorize on the code
- **WHEN** a request to an API-key management endpoint is authorized
- **THEN** the check is against the `API_KEY_MANAGE` permission code and not against any role name

#### Scenario: A key cannot exceed the bound user's grants
- **WHEN** a key bound to a user authenticates a request
- **THEN** the authority available to that request is exactly the permission-code grants resolved for the bound user in the bound company, and no more

### Requirement: API Key Is An Alternate Authentication Source

The RBAC authentication model SHALL treat an API key as an alternate source of the same
company-context principal produced by interactive login: the resolved principal SHALL carry the
bound user's id, the bound company, the resolved department, and the permission-code grants for
that company, so that permission-code authorization and data-scope enforcement operate
identically regardless of whether the request was authenticated by a JWT or by an API key.

#### Scenario: Identical authorization surface for both sources
- **WHEN** the same endpoint is called once with a JWT and once with an API key bound to the same user and company
- **THEN** permission-code authorization and data-scope enforcement produce the same allow/deny outcome for both, except where API-key requests are additionally barred from approval actions

### Requirement: The permission catalog matches the codes the application declares

The `permission` table SHALL contain a row for every permission code the application enforces, so that a code named by an authorization guard can be listed and granted. The system SHALL provide a command that reconciles the catalog to the declared codes by inserting the rows that are missing, and that command SHALL write nothing outside the `permission` table. Reconciliation SHALL be additive: a row whose code is no longer declared SHALL be left in place rather than deleted or deactivated.

#### Scenario: A slice introduces new permission codes

- **GIVEN** an environment whose `permission` table predates a slice that declares new codes
- **WHEN** the reconcile command runs
- **THEN** a row is inserted for each newly declared code, and no company, user, role, document type, or other record is created

#### Scenario: Reconciling twice changes nothing the second time

- **WHEN** the reconcile command runs against an environment whose catalog is already complete
- **THEN** no row is inserted, updated, or removed

#### Scenario: A code disappears from the source

- **GIVEN** a `permission` row whose code the application no longer declares
- **WHEN** the reconcile command runs
- **THEN** the row is left untouched, and any `role_permission` grant referencing it remains valid

### Requirement: A short permission catalog is detectable without changing it

The system SHALL provide a read-only command that compares the declared permission codes against the rows in the `permission` table and fails when any declared code has no row, naming the missing codes. The command SHALL make no writes, so it can be used to ask what an environment is missing without altering it.

#### Scenario: The catalog is missing codes

- **WHEN** the check command runs against an environment whose catalog is short
- **THEN** it exits non-zero and lists every declared code that has no row

#### Scenario: The catalog is complete

- **WHEN** the check command runs against an environment whose catalog is complete
- **THEN** it exits zero

### Requirement: A Stored Password Hash Is Never Serialized

A user's stored password hash SHALL NOT appear in any response, regardless of which endpoint loaded the user or whether that endpoint was written with the hash in mind. The exclusion SHALL be enforced where the property is declared, not at each place a user is returned, so that an endpoint added later inherits it rather than having to remember it.

Code that verifies or replaces a password SHALL continue to read and write the property directly: the exclusion governs what leaves the system, not what the system may hold.

#### Scenario: A serialized user carries no hash

- **GIVEN** a user with a stored password hash
- **WHEN** the user is serialized into a response
- **THEN** the hash is absent while the user's other serialized fields are present

#### Scenario: Authentication still reads the hash

- **GIVEN** a user with a stored password hash
- **WHEN** a password is verified against that user
- **THEN** the verification reads the stored hash and succeeds or fails on its merits

### Requirement: Service Account Identity

An `app_user` SHALL carry an explicit marker distinguishing a **service account** — a
non-human identity that exists to be authenticated by an API key — from a person's login
account. The marker SHALL be a stored property of the account, and the system SHALL NOT infer
the identity kind from the absence of a `password_hash`, because a person's account may also
lack one and would otherwise be indistinguishable from a bot.

A service account SHALL never hold a `password_hash`. Accounts that existed before this
capability SHALL be treated as human accounts.

Apart from this marker a service account is an ordinary principal: it is authorized by the same
permission codes, at the same scopes, through the same `user_company_role` assignments as any
other user. This capability adds an identity kind, not a second authorization model.

#### Scenario: A service account is marked, not inferred

- **WHEN** a service account and a human account that happens to have no `password_hash` are both read
- **THEN** only the service account is reported as one, distinguished by its stored marker rather than by the missing hash

#### Scenario: Existing accounts are unaffected

- **WHEN** the marker is introduced
- **THEN** every account that already existed is treated as a human account

#### Scenario: Authorization is unchanged for a service account

- **GIVEN** a service account holding a role that grants a permission code at `DEPARTMENT` scope
- **WHEN** it acts through an API key
- **THEN** it is permitted exactly what that code and scope allow, identically to a human holding the same role

### Requirement: Create A Service Account With First Company Access

The system SHALL let a user holding `RBAC_MANAGE` create a service account in the active company,
supplying a `username`, an `email`, and the first company-role assignment (`role_id`,
`department_id`). The account and its `user_company_role` SHALL be created **atomically** — either
both exist or neither does — so a service account never lands in a state where it can neither
authenticate nor be granted a credential.

The request SHALL NOT accept a password, and the system SHALL NOT set one by any means, including
from server configuration. The created account SHALL be marked as a service account and SHALL be
recorded as email-verified, so it is never reported as a person awaiting verification.

An `email` SHALL be required because `app_user.email` is `not null` and unique; it identifies the
account and SHALL NOT be sent any mail. No verification email SHALL be sent for a service account.

The active company SHALL be taken from the request context and never from the request body, and
`role_id` and `department_id` SHALL be rejected unless they belong to that company, so no
cross-company grant is reachable. A `username` or `email` that already exists SHALL be rejected.

#### Scenario: Create a service account with its first assignment

- **WHEN** an `RBAC_MANAGE` user creates a service account with a unique `username` and `email`, and a `role_id` and `department_id` of the active company
- **THEN** the account is created, marked as a service account, with a `user_company_role` in the active company
- **AND** it holds no `password_hash`

#### Scenario: No password is ever set

- **WHEN** a service account is created
- **THEN** no password is accepted in the request and none is set from server configuration

#### Scenario: Creation is atomic

- **WHEN** creating the first company-role assignment fails
- **THEN** no service account remains

#### Scenario: A cross-company role is rejected

- **WHEN** an `RBAC_MANAGE` user supplies a `role_id` or `department_id` belonging to another company
- **THEN** the request is rejected and no account is created

#### Scenario: A duplicate username or email is rejected

- **WHEN** the supplied `username` or `email` already belongs to any account
- **THEN** the request is rejected and no account is created

#### Scenario: Creation requires RBAC_MANAGE

- **WHEN** a user without `RBAC_MANAGE` attempts to create a service account
- **THEN** the request is rejected and no account is created

#### Scenario: No verification email is sent

- **WHEN** a service account is created
- **THEN** no verification email is sent, and the account is already recorded as verified

#### Scenario: The account can immediately be issued an API key

- **WHEN** an `API_KEY_MANAGE` user opens the key-issuance surface after a service account is created in the active company
- **THEN** that service account is an eligible target, because it already holds an ACTIVE membership in that company

### Requirement: A Service Account Cannot Authenticate Interactively

Authentication SHALL deny a service account presenting a username and password, explicitly on the
basis of its identity kind rather than only as a consequence of its missing `password_hash`. The
denial SHALL use the same generic invalid-credentials outcome as a wrong password, and SHALL NOT
disclose that the username belongs to a service account, so an unauthenticated caller cannot
enumerate which accounts are service accounts.

A service account SHALL remain able to authenticate by API key, which resolves to the bound
principal without consulting a password.

#### Scenario: Interactive login is denied

- **WHEN** a caller attempts to log in with a service account's username and any password
- **THEN** authentication is denied and no token is issued

#### Scenario: The denial does not disclose the identity kind

- **WHEN** a caller attempts to log in as a service account
- **THEN** the outcome is the generic invalid-credentials outcome, indistinguishable from a wrong password against a human account

#### Scenario: API key authentication still works

- **WHEN** a service account presents a valid API key bound to it
- **THEN** the request is authenticated as that principal with its granted permission codes

### Requirement: The Application Reports A Catalog It Cannot Fully Honour

The application SHALL, at startup, compare the permission codes it declares against the rows in the
`permission` table, and SHALL report every declared code that has no row. The report SHALL name the
codes rather than only counting them, because the operator's next question is always which ones.

The application SHALL NOT refuse to start on a short catalog. An installation missing some codes
still serves every capability whose codes are present, and refusing to boot would turn a partial
gap into a total outage. The application SHALL NOT insert the missing rows either: reconciling is a
deliberate, separately invoked act, and a write on every process start would make the catalog
change without anyone asking it to.

This covers the case the reconcile command and the read-only check do not: an environment whose
database arrived without a deploy — a restore, a clone, a snapshot — and so never met either.

#### Scenario: A restored database is short of codes

- **GIVEN** a database restored from an environment older than a slice that declares new codes
- **WHEN** the application starts
- **THEN** it logs a report naming each declared code with no row, and continues serving

#### Scenario: A complete catalog is not reported as a problem

- **GIVEN** an environment whose catalog holds a row for every declared code
- **WHEN** the application starts
- **THEN** no missing-code report is emitted

#### Scenario: Startup writes no permission row

- **GIVEN** an environment whose catalog is short
- **WHEN** the application starts
- **THEN** the `permission` table is unchanged, and the codes are still missing until the reconcile
  command is run

#### Scenario: The comparison has one source

- **WHEN** the startup report and the read-only check command are compared
- **THEN** both derive the declared codes and the missing set from the same functions, so the two
  can never disagree about what an environment is missing
