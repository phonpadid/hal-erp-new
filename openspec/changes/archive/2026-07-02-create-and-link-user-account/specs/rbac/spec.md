## ADDED Requirements

### Requirement: Create Login Account With Server-Side Initial Password

The system SHALL allow an authorized administrator to create an `app_user` login account by
supplying only a `username` and `email`. The account's initial password SHALL be taken from the
`USER_PASSWORD` server environment variable and stored only as a one-way hash; the administrator
SHALL NOT supply a password. New accounts SHALL be created with status `ACTIVE`. The system SHALL
enforce uniqueness of `username` and `email`, and SHALL refuse to create an account when
`USER_PASSWORD` is not configured.

#### Scenario: Account created with hashed initial password

- **WHEN** an authorized admin creates an account with a unique `username` and `email` and
  `USER_PASSWORD` is configured
- **THEN** an `app_user` is created with status `ACTIVE` and `password_hash` set to the hash of
  `USER_PASSWORD`, and no plaintext password is stored or returned

#### Scenario: Initial password authenticates

- **WHEN** the newly created user logs in with the value of `USER_PASSWORD`
- **THEN** authentication succeeds (the stored hash verifies against `USER_PASSWORD`)

#### Scenario: Duplicate username or email is rejected

- **WHEN** the admin creates an account whose `username` or `email` already belongs to another
  `app_user`
- **THEN** the request is rejected and no new account is created

#### Scenario: Missing USER_PASSWORD fails closed

- **WHEN** the admin attempts to create an account while `USER_PASSWORD` is unset or empty
- **THEN** the request is rejected and no account is created (no default or empty password is used)
