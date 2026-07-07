## ADDED Requirements

### Requirement: Own Roles and Permissions in Profile Read

The read-own-profile response SHALL additionally include, for the active company, the
name(s) of every `role` the signed-in user holds via `user_company_role` (a user MAY hold
more than one `role` per company) and the full resolved `permission.code` list with each
code's effective scope (`OWN`/`DEPARTMENT`/`COMPANY`/`GROUP`), computed by the same
resolution the authorization guard uses (union of `role_permission` grants across all of
the user's roles in that company, broadest scope wins on conflict). This projection SHALL
NOT alter how authorization itself is computed and SHALL be scoped to the active company
only.

#### Scenario: Profile includes held role names

- **GIVEN** a signed-in user holding two `role` rows in the active company
- **WHEN** they read their profile
- **THEN** the response lists both roles' names

#### Scenario: Profile includes the resolved permission list with scope

- **GIVEN** a signed-in user whose roles grant permission codes at different scopes
- **WHEN** they read their profile
- **THEN** the response includes each granted `permission.code` paired with its resolved
  scope, matching the broadest-scope-wins union the authorization guard would compute

#### Scenario: Roles and permissions are scoped to the active company

- **GIVEN** the user holds roles in more than one company
- **WHEN** they read their profile with a token bound to company A
- **THEN** only company A's roles and resolved permissions are returned
