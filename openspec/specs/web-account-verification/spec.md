# web-account-verification

## Purpose
The public-facing email-verification surface: an unauthenticated `/verify-email` page that
confirms an account from the token in its link, and the login screen's distinct messaging when
sign-in is denied because the account's email is not yet verified.

## Requirements

### Requirement: Public Verify-Email Page

The system SHALL provide a public page at `/verify-email` that reads the `token` from the URL, calls the
confirm endpoint, and shows the outcome (success or invalid/expired). On success it SHALL offer a link to
the login page. The page SHALL require no authentication.

#### Scenario: Confirming a valid link

- **WHEN** a user opens the verify-email link from their inbox with a valid token
- **THEN** the page confirms the account, shows a success state, and offers a way to continue to login

#### Scenario: Confirming an invalid or expired link

- **WHEN** the token is missing, invalid, expired, or already used
- **THEN** the page shows a clear "link is invalid or expired" state without crashing

### Requirement: Login Explains An Unverified Email

When login is denied because the email is not verified, the login screen SHALL show a message distinct from
the generic invalid-credentials error, telling the user their email is not yet verified (to check their
inbox or ask an administrator).

#### Scenario: Unverified login shows a specific message

- **WHEN** a user submits correct credentials for an account whose email is not verified
- **THEN** the login screen shows an "email not verified" message, not the generic credentials error
