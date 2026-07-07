## ADDED Requirements

### Requirement: Linkable Account Read For Employee Admin

The system SHALL provide a read, guarded by `EMPLOYEE_MANAGE`, that returns login accounts
(`app_user`) which are **not yet linked to any employee**, so an employee admin can pick an existing
account to link without knowing its `app_user` id. Each returned account SHALL include `id`,
`username`, and `email`, and SHALL NOT include any per-company role assignment. The read SHALL
support an optional case-insensitive search over `username` and `email`. Because `app_user` is
global and each account may be linked to at most one employee, "not yet linked" means linked to no
employee in any company; an account already linked to an employee SHALL be excluded.

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
