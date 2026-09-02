## ADDED Requirements

### Requirement: Service Account Administration

The web app SHALL let an `RBAC_MANAGE` user create a **service account** — a non-human identity
that authenticates only by API key — from the access-administration area's user list, without
first creating an employee record. This is the app's only surface for creating an account that is
not a person; creating one through the employee screens would both invent a fake employee and give
the account a working interactive password.

The create surface SHALL collect a `username`, an `email`, and the first company-role assignment
(department and role), mirroring the server's requirement that the account and its assignment are
created together. It SHALL NOT offer a password field, because a service account never has one.
Validation SHALL use a shared schema mirroring the backend DTO so client and server rules cannot
drift. The affordance SHALL be gated on `RBAC_MANAGE` as a UX-only guard; the server stays
authoritative.

The user list SHALL visibly distinguish service accounts from people, so an administrator can tell
at a glance which principals are not human. For a service account the app SHALL NOT offer actions
that only make sense for a person — password reset and email verification.

Issuing the account's API key SHALL remain a separate surface under `API_KEY_MANAGE`; creating the
identity and issuing its credential are distinct acts with distinct permissions.

All labels SHALL come from i18n, and the surface SHALL use PrimeUI theme tokens so it renders
correctly in both light and dark mode.

#### Scenario: Create a service account from the user list

- **WHEN** an `RBAC_MANAGE` user submits the create-service-account surface with a unique username, an email, a department, and a role of the active company
- **THEN** the account is created with that assignment and appears in the user list, marked as a service account

#### Scenario: No password is ever requested

- **WHEN** an `RBAC_MANAGE` user opens the create-service-account surface
- **THEN** no password field is presented

#### Scenario: Service accounts are visually distinguishable

- **WHEN** the user list contains both people and service accounts
- **THEN** each service account is visibly marked as one

#### Scenario: Person-only actions are hidden for a service account

- **WHEN** an administrator views a service account's row
- **THEN** no password-reset or email-verification action is offered for it

#### Scenario: The affordance is permission-gated

- **WHEN** a user without `RBAC_MANAGE` views the access-administration area
- **THEN** the create-service-account affordance is not offered

#### Scenario: Validation errors are shown before submitting

- **WHEN** the user submits without a username, without an email, or without choosing a role and department
- **THEN** the form shows validation errors and sends no request

#### Scenario: A duplicate username is reported

- **WHEN** the submitted username already belongs to an account and the server rejects it
- **THEN** the app shows the failure and no new account appears in the list

#### Scenario: Issuing the key stays a separate, separately-permitted surface

- **WHEN** an `RBAC_MANAGE` user finishes creating a service account
- **THEN** no API key is issued by that act, and issuing one remains available only under `API_KEY_MANAGE`
