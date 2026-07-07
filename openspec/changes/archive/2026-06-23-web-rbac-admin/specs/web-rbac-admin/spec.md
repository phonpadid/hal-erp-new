## ADDED Requirements

### Requirement: Role and Permission Management

The web app SHALL let an `RBAC_MANAGE` user list the active company's roles, create a role, view
a role's permission grants, add a grant (a permission code with a data-visibility scope), and
detach a grant. Available permission codes SHALL come from the permission catalog.

#### Scenario: Create a role and grant a permission

- **WHEN** an `RBAC_MANAGE` user creates a role and adds a permission code with a scope
- **THEN** the role appears with that grant in its permission list

#### Scenario: Detach a grant

- **WHEN** the user detaches a permission from a role
- **THEN** that grant no longer appears on the role

### Requirement: User Role Assignments

The web app SHALL let an `RBAC_MANAGE` user list users with their assignments in the active
company, assign a role (role + department, optional default and validity window), remove a single
assignment, and revoke all of a user's access to the active company.

#### Scenario: Assign a role to a user

- **WHEN** the user assigns a role and department to a user
- **THEN** the assignment appears under that user for the active company

#### Scenario: Remove an assignment

- **WHEN** the user removes one of a user's assignments
- **THEN** that assignment no longer appears

### Requirement: Company-Scoped Access Administration

Roles and assignments shown and managed SHALL be those of the active company; switching the
active company SHALL change the roles and assignments shown. User accounts are global, but their
assignments are per-company.

#### Scenario: Roles are scoped to the active company

- **WHEN** the admin views roles while a company is active
- **THEN** only that company's roles are listed

### Requirement: Permission-Gated Access Administration

The access-admin navigation, lists, and actions SHALL be shown only to users holding
`RBAC_MANAGE` (UX only; the server still enforces).

#### Scenario: Access admin hidden without permission

- **WHEN** a user without `RBAC_MANAGE` is signed in
- **THEN** the access-admin navigation entry is not shown
