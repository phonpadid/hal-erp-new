## ADDED Requirements

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
