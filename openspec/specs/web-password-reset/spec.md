# Web Password Reset Specification

## Purpose
The public web screens for self-service password recovery: the "Forgot password?"
entry on login, the reset-request form, the check-email confirmation, and the
token-driven set-new-password page. All copy is i18n-driven and the flow never
discloses whether an account exists.

## Requirements

### Requirement: Forgot-Password Entry on Login
The web app SHALL present a "Forgot password?" link on the login view that
navigates to the reset-request page. The link SHALL be a public route (no auth) and
its label SHALL come from i18n (en + la), never a hardcoded string.

#### Scenario: Link is visible on login
- **WHEN** an unauthenticated user opens the login view
- **THEN** a "Forgot password?" link is shown
- **AND** clicking it navigates to the reset-request page without requiring login

### Requirement: Reset-Request Page
The web app SHALL provide a public page where the user enters a username or email
and submits it to the forgot-password endpoint. The form SHALL validate input with
a Zod schema mirroring the backend DTO via `zodResolver`. On submit — regardless of
whether an account matched — the app SHALL route to the check-email confirmation and
SHALL NOT reveal whether an account exists.

#### Scenario: Submitting the request confirms generically
- **WHEN** the user submits a username or email on the reset-request page
- **THEN** the app shows the check-your-email confirmation
- **AND** the message does not state whether an account was found

#### Scenario: Invalid input is caught client-side
- **WHEN** the user submits an empty or malformed identifier
- **THEN** the Zod resolver shows a field error and no request is sent

### Requirement: Check-Email Confirmation Page
The web app SHALL provide a public confirmation page telling the user that, if the
account exists, a reset link has been emailed. Copy SHALL come from i18n and SHALL
NOT disclose the target email address or account existence.

#### Scenario: Confirmation is neutral
- **WHEN** the check-email page renders
- **THEN** it instructs the user to check their inbox for a link if an account exists
- **AND** shows no account-specific detail

### Requirement: Set-New-Password Page
The web app SHALL provide a public page reached from the emailed link that carries
the token. On load it SHALL verify the token via the backend and, if invalid or
expired, SHALL show an error with a path back to request a new link. If valid, it
SHALL present a new-password form (with confirmation) validated by a Zod schema
mirroring the backend DTO; on success it SHALL route the user to login.

#### Scenario: Valid token shows the password form
- **WHEN** the page loads with a token that verifies as valid
- **THEN** the new-password form is shown

#### Scenario: Invalid or expired token is handled
- **WHEN** the page loads with a token that fails verification
- **THEN** an error state is shown with a link to request a new reset

#### Scenario: Successful reset returns to login
- **WHEN** the user submits a valid new password that passes both Zod validation and the backend
- **THEN** the app navigates to the login view so the user can sign in with the new password

#### Scenario: Password confirmation must match
- **WHEN** the password and its confirmation differ
- **THEN** the Zod resolver shows a field error and no request is sent
