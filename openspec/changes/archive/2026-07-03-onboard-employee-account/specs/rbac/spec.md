## ADDED Requirements

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
