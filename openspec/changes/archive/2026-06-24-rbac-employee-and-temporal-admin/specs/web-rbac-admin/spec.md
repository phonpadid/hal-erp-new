## MODIFIED Requirements

### Requirement: User Role Assignments

The web app SHALL let an `RBAC_MANAGE` user list users with their assignments in the active
company, assign a role (role + department, optional default and a validity window of
`valid_from`/`valid_to` for temporary or acting authority), remove a single assignment, and revoke
all of a user's access to the active company. The assign form SHALL expose `valid_from` and
`valid_to` date inputs (e.g. behind an "acting / temporary" affordance) and SHALL reject a window
where `valid_to` precedes `valid_from`. Each listed assignment SHALL display its validity window
when set, and SHALL visibly flag assignments that are expired or expiring.

#### Scenario: Assign a role to a user

- **WHEN** the user assigns a role and department to a user
- **THEN** the assignment appears under that user for the active company

#### Scenario: Assign acting authority with a validity window

- **WHEN** the user assigns a role with a `valid_from` and `valid_to`
- **THEN** the assignment appears with that validity window shown

#### Scenario: Invalid validity window is rejected

- **WHEN** the user sets a `valid_to` earlier than `valid_from`
- **THEN** the form shows a validation error and does not submit

#### Scenario: Remove an assignment

- **WHEN** the user removes one of a user's assignments
- **THEN** that assignment no longer appears

## ADDED Requirements

### Requirement: Cross-Company Assignments View

The web app SHALL let an `RBAC_MANAGE` user open a read-only view of a single user's active
assignments across the companies the requester may administer, showing for each the company, role,
department, and validity window. The view SHALL NOT offer cross-company edit actions.

#### Scenario: View a user's authority across companies

- **WHEN** the admin opens the cross-company assignments view for a user
- **THEN** the user's active assignments in companies the admin administers are listed with company,
  role, department, and validity window

#### Scenario: View is read-only

- **WHEN** the admin opens the cross-company assignments view
- **THEN** no edit or delete action is offered within that view
