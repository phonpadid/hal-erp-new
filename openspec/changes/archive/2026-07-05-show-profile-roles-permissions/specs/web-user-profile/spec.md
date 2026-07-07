## ADDED Requirements

### Requirement: Roles and Permissions Section

The "My Profile" page SHALL display a read-only "Roles & Permissions" section showing
the signed-in user's role name(s) and their resolved permission codes (grouped or tagged
by scope: `OWN`/`DEPARTMENT`/`COMPANY`/`GROUP`) for the active company, sourced from the
read-own-profile response. This section SHALL NOT offer any edit, add, or remove action —
managing roles and permissions remains an `RBAC_MANAGE`-gated admin function elsewhere in
the app. All labels SHALL come from i18n (en + la), never hardcoded strings.

#### Scenario: Roles and permissions render on the profile page

- **WHEN** the profile page loads for a signed-in user
- **THEN** it displays the user's role name(s) and their permission codes with scope for
  the active company

#### Scenario: Section is read-only

- **WHEN** the profile page renders the Roles & Permissions section
- **THEN** no control on that section allows adding, removing, or editing a role or
  permission

#### Scenario: Switching active company updates the section

- **GIVEN** the user switches their active company
- **WHEN** the profile page reloads
- **THEN** the Roles & Permissions section reflects only the new active company's roles
  and permissions
