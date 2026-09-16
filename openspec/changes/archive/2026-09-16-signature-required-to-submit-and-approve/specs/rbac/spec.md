## MODIFIED Requirements

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
