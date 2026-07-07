## ADDED Requirements

### Requirement: Email Verification State On Accounts

The system SHALL track per-account email-verification state on `app_user` via a nullable
`email_verified_at` timestamp (null = unverified; non-null = the instant the email was confirmed). This
state SHALL be independent of `status` (ACTIVE/RESIGNED) — a newly created account is `ACTIVE` yet
unverified. Verification SHALL be recorded with a single-use, time-limited token whose **hash only** is
persisted (the raw token exists only in the emailed link), following the same custody rules as the
password-reset token.

#### Scenario: New account starts unverified

- **WHEN** an account is created
- **THEN** its `email_verified_at` is null (unverified) while its `status` is `ACTIVE`

#### Scenario: Only the token hash is stored

- **WHEN** a verification token is issued
- **THEN** only its hash is persisted, with an expiry and a single-use marker; the raw token appears only
  in the emailed link

### Requirement: Verification Email On Account Creation

The system SHALL issue a verification token and send a verification email whenever an account is created,
both via create-and-link (create-account) and via onboarding (onboard). The email SHALL contain a link to
the public verify page carrying the raw token, reusing the existing email transport. Email delivery SHALL be
best-effort: when SMTP is not configured (dev/test) the send is a no-op and account creation still succeeds.

#### Scenario: Creation sends a verification link

- **WHEN** an admin creates or onboards an account
- **THEN** a verification token is issued and a verification email with the link is sent to the account's
  email

#### Scenario: Creation succeeds even if mail cannot be sent

- **WHEN** SMTP is unconfigured and an account is created
- **THEN** the account is still created (unverified) and no error is surfaced from the email step

### Requirement: Confirm Email With A Token

The system SHALL provide a public endpoint that, given a valid unconsumed unexpired token, marks the
account's email verified (sets `email_verified_at`) and consumes the token (single-use). An invalid,
expired, or already-consumed token SHALL be rejected without changing any account.

#### Scenario: Valid token verifies the account

- **WHEN** the verify endpoint is called with a valid token
- **THEN** the account's `email_verified_at` is set and the token is consumed so it cannot be reused

#### Scenario: Invalid or expired token is rejected

- **WHEN** the verify endpoint is called with an invalid, expired, or already-consumed token
- **THEN** the request is rejected and no account is modified

### Requirement: Login Requires A Verified Email

Authentication SHALL deny a user whose email is not verified, with an outcome distinct from invalid
credentials so the client can prompt the user to verify. Password validity and `status = ACTIVE` are
checked as before; an unverified but otherwise valid account SHALL NOT receive an access token or company
list.

#### Scenario: Unverified account cannot log in

- **WHEN** a user with a correct password and `ACTIVE` status but null `email_verified_at` authenticates
- **THEN** login is denied with a distinct "email not verified" outcome and no token is issued

#### Scenario: Verified account logs in normally

- **WHEN** the same user authenticates after their email is verified
- **THEN** login proceeds as usual (resolving companies and, when a default exists, a token)

### Requirement: Admin May Mark An Account Verified

The system SHALL let an `EMPLOYEE_MANAGE` admin mark an employee's linked account verified **without**
sending or requiring an email, as an escape hatch when mail cannot be delivered. This action SHALL set
`email_verified_at` if not already set and SHALL be idempotent; it SHALL NOT un-verify an account and SHALL
NOT be available for an employee that has no linked account.

#### Scenario: Admin verifies an account manually

- **WHEN** an `EMPLOYEE_MANAGE` admin marks a linked, unverified account verified
- **THEN** the account's `email_verified_at` is set and the user can log in, with no email involved

#### Scenario: Manual verify is idempotent and one-way

- **WHEN** an admin marks an already-verified account verified again
- **THEN** the account stays verified (the original verification time is unchanged) and the action cannot
  clear verification
