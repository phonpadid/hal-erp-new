## ADDED Requirements

### Requirement: Reset Request (Anti-Enumeration)
The system SHALL accept a reset request identified by a username or an email and
SHALL always return the same generic acknowledgement, whether or not a matching
`app_user` exists or is active. The response MUST NOT reveal account existence,
status, or the target email address.

When exactly one active `app_user` matches, the system SHALL create a
`password_reset_token` row for that user before responding.

#### Scenario: Existing active account requests a reset
- **WHEN** a reset is requested for a username or email that matches an ACTIVE `app_user`
- **THEN** a `password_reset_token` row is created for that `user_id`
- **AND** a reset email is dispatched to that user's `app_user.email`
- **AND** the response is a generic acknowledgement with no account details

#### Scenario: Unknown identifier is indistinguishable
- **WHEN** a reset is requested for a username or email that matches no `app_user`
- **THEN** no `password_reset_token` row is created
- **AND** no email is sent
- **AND** the response is byte-for-byte the same generic acknowledgement as a match

#### Scenario: Inactive account does not receive a reset
- **GIVEN** an `app_user` whose `status` is not ACTIVE
- **WHEN** a reset is requested for that account
- **THEN** no token is created and no email is sent
- **AND** the response is the same generic acknowledgement

### Requirement: Single-Use, Time-Limited, Hashed Tokens
The system SHALL generate a cryptographically random reset token, store only its
hash in `password_reset_token.token_hash` (never the raw token), and stamp
`password_reset_token.expires_at` to a short TTL (SHALL be at most 60 minutes). The
raw token SHALL appear only in the emailed link. A token SHALL be usable at most
once; consumption is recorded by setting `password_reset_token.consumed_at`.

Creating a new reset request for a user SHALL invalidate that user's other
outstanding (unconsumed, unexpired) tokens.

#### Scenario: Only the hash is persisted
- **WHEN** a reset token is generated
- **THEN** `password_reset_token.token_hash` holds a hash of the token
- **AND** the raw token is present only in the emailed link, never in storage or logs

#### Scenario: A newer request supersedes older tokens
- **GIVEN** a user with an outstanding unconsumed token
- **WHEN** the same user requests another reset
- **THEN** the earlier token can no longer be used to set a password

### Requirement: Token Verification
The system SHALL expose a verification that reports whether a raw token is
currently usable — it maps to a `password_reset_token` row whose `consumed_at` is
null and whose `expires_at` is in the future. Verification SHALL NOT consume the
token and SHALL NOT reveal the associated username or email.

#### Scenario: Valid token verifies
- **GIVEN** an unconsumed token whose `expires_at` is in the future
- **WHEN** it is verified
- **THEN** the system reports it as valid without consuming it or returning account identity

#### Scenario: Expired or consumed token fails verification
- **WHEN** a token that is past `expires_at` or already has `consumed_at` set is verified
- **THEN** the system reports it as invalid

### Requirement: Set New Password
The system SHALL set a new password only against a valid, unexpired, unconsumed
token. It SHALL hash the new password with the existing password-hashing service
(bcrypt) and write it to `app_user.password_hash`, set the token's `consumed_at`,
and invalidate the user's other outstanding tokens. An invalid, expired, or
already-consumed token SHALL be rejected without changing any password.

#### Scenario: Valid token sets the new password
- **GIVEN** a valid unconsumed token for a user
- **WHEN** a new password meeting the password policy is submitted with that token
- **THEN** `app_user.password_hash` is updated to the hash of the new password
- **AND** the token's `consumed_at` is set
- **AND** the user can log in with the new password

#### Scenario: A token cannot be reused
- **GIVEN** a token already used to set a password
- **WHEN** it is submitted again with a new password
- **THEN** the request is rejected and no password is changed

#### Scenario: Weak password is rejected
- **WHEN** a new password that fails the password policy is submitted with a valid token
- **THEN** the request is rejected, the password is unchanged, and the token remains usable
