## ADDED Requirements

### Requirement: Read Own Profile

The system SHALL expose an authenticated endpoint that returns the signed-in user's own
profile, resolving the user from the JWT and never from an id in the request path. The
response SHALL include the `app_user` identity fields `username`, `email`,
`email_verified_at`, and `status`, and SHALL NOT include `password_hash`. When an
`employee` row links to the user (`employee.user_id`) within the active company, the
response SHALL also include that employee's `full_name`, `position`, and department name;
when no such employee exists, the identity fields SHALL still be returned and the employee
fields SHALL be omitted or null.

#### Scenario: Signed-in user reads their own profile

- **WHEN** an authenticated user requests their profile
- **THEN** the response contains their `app_user.username`, `email`, `email_verified_at`,
  and `status`
- **AND** the response never contains `app_user.password_hash`

#### Scenario: Linked employee is included within the active company

- **GIVEN** an `employee` row whose `user_id` is the signed-in user and whose `company_id`
  is the active company
- **WHEN** the user reads their profile
- **THEN** the response includes that employee's `full_name`, `position`, and department name

#### Scenario: Account without a linked employee

- **GIVEN** a user with no `employee` row referencing them in the active company
- **WHEN** the user reads their profile
- **THEN** the identity fields are returned and the employee fields are omitted or null

#### Scenario: Employee is resolved only within the active company

- **GIVEN** the user is linked to employees in more than one company
- **WHEN** the user reads their profile with a token bound to company A
- **THEN** only the company-A employee's fields are returned and no other company's data is read

### Requirement: Change Own Password

The system SHALL expose an authenticated endpoint that changes the signed-in user's own
password, identifying the user from the JWT. The request SHALL require the user's current
password and a new password. The system SHALL verify the current password against
`app_user.password_hash` using the same hashing primitive as login, and on success SHALL
overwrite `app_user.password_hash` with the hash of the new password. This flow SHALL NOT
send an email and SHALL NOT create or consume a `password_reset_token`. The system SHALL
NOT log or return password material.

#### Scenario: Correct current password changes the password

- **GIVEN** an authenticated user
- **WHEN** they submit their correct current password and a valid new password
- **THEN** `app_user.password_hash` is updated to the hash of the new password
- **AND** they can authenticate with the new password and not the old one

#### Scenario: Wrong current password is rejected

- **WHEN** the user submits a current password that does not match `app_user.password_hash`
- **THEN** the request is rejected with a generic authorization error
- **AND** `app_user.password_hash` is unchanged

#### Scenario: New password equal to current is rejected

- **WHEN** the user submits a new password identical to the current password
- **THEN** the request is rejected with a validation error and the password is unchanged

#### Scenario: New password failing the strength policy is rejected

- **WHEN** the user submits a new password that violates the strength policy
- **THEN** the request is rejected with a validation error and the password is unchanged

#### Scenario: No token or email is involved

- **WHEN** a password change succeeds
- **THEN** no `password_reset_token` row is created or consumed and no reset email is sent
