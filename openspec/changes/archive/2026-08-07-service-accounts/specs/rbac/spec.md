## ADDED Requirements

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

## MODIFIED Requirements

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
