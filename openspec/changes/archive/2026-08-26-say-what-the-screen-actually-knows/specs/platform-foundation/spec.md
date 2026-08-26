## MODIFIED Requirements

### Requirement: Local development environment

The project SHALL provide a reproducible local environment: a `docker-compose` stack
for PostgreSQL and S3-compatible storage (MinIO), an `.env.example` documenting required
configuration, and README instructions to install dependencies, run migrations, and
start both apps.

The API origin the front-end is configured to call and the port the backend is configured to listen
on SHALL be checkable for agreement by a documented command, which SHALL fail and name both values
when they disagree.

Both values live in gitignored `.env` files, so they drift per machine while the committed
configuration stays consistent. When they do, every request fails at the network layer and the
login screen reports a connection error that names neither file — the reader has no way to tell a
misconfigured port from a backend that is not running.

#### Scenario: Stack starts from compose

- **WHEN** a developer runs the documented compose command
- **THEN** PostgreSQL and MinIO start and the backend can connect using the values from
  `.env.example`

#### Scenario: The documented defaults agree

- **GIVEN** a freshly checked-out repository configured per the README and `.env.example`
- **WHEN** the documented check is run
- **THEN** it passes, and starting both apps lets the login form reach the backend

#### Scenario: A disagreeing pair is reported

- **GIVEN** a configuration whose front-end API origin names a port the backend does not bind
- **WHEN** the documented check is run
- **THEN** it fails and names both values
