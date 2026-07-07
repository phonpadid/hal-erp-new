## ADDED Requirements

### Requirement: Authorization Read Surface

The system SHALL provide reads, under `RBAC_MANAGE` and scoped to the active company, of: the
company's roles each with their permission grants (`code`, `name`, `scope`); the permission
catalog (`code`, `name`, `module`); and users with their active-company assignments (role,
department, default flag, validity window). User accounts are global; assignments are
company-scoped.

#### Scenario: Roles include their grants

- **WHEN** an `RBAC_MANAGE` user lists roles
- **THEN** each active-company role is returned with its granted permission codes and scopes

#### Scenario: Users include their active-company assignments

- **WHEN** an `RBAC_MANAGE` user lists users
- **THEN** each user's assignments in the active company are returned (and not those of other
  companies)

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
