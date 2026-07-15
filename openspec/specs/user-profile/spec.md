# User Profile Specification

## Purpose
Self-service account access for an already-authenticated user: reading one's own
identity and linked employee display fields, and rotating one's own password by
proving the current one. This complements `password-reset` (unauthenticated,
token-based recovery) and `user-preferences` (UI settings) — it never issues tokens
or emails, and it never accepts an id in the request path, so a user can only ever
read or mutate their own account.

## Requirements

### Requirement: Read Own Profile

The system SHALL expose an authenticated endpoint that returns the signed-in user's
own profile, resolving the user from the JWT and never from an id in the request path. The
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

### Requirement: Upload Own Profile Image
The system SHALL expose an authenticated endpoint that lets the signed-in user set their
own 1:1 profile image, resolving the user from the JWT and never from an id in the request
path. The image bytes SHALL be sent to the backend (multipart), which validates the mime
type against the allow-list (`image/png`, `image/jpeg`, `image/webp`) and enforces the size
cap on the received bytes, then writes them to object storage (S3/MinIO) server-side; the
browser SHALL NOT PUT the bytes directly to the bucket. Only the resulting object key SHALL
be persisted on `app_user.profile_image_path`; the raw bytes SHALL NOT be stored in the
database. The profile read SHALL continue to return a short-lived presigned download URL for
the current image, or null when none is set.

#### Scenario: User sets their profile image
- **WHEN** an authenticated user posts a PNG image to the profile-image upload endpoint
- **THEN** the backend writes the bytes to object storage and sets `app_user.profile_image_path`
  to the stored object key
- **AND** the response returns a short-lived presigned URL for the new image
- **AND** no image bytes are stored in the database

#### Scenario: Oversized or disallowed profile image is rejected
- **WHEN** the user posts a file exceeding the size cap or whose mime type is not in the
  allow-list
- **THEN** the request is rejected with a validation error and `app_user.profile_image_path`
  is unchanged and no object is written

#### Scenario: Profile image is private to the user
- **GIVEN** an authenticated user
- **WHEN** they upload a profile image
- **THEN** the image is associated with their own `app_user` resolved from the JWT, never
  from a path id, so a user can only set their own profile image
