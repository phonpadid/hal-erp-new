## ADDED Requirements

### Requirement: A Deploy Runs Only After Its Checks Pass

A deploy SHALL NOT begin until a preceding verification has passed in full. If any check fails, no command SHALL be executed against the production host — not the checkout, not the migrations, and not the restart.

The verification SHALL cover the backend suite and the frontend typecheck and suite, so that a release is blocked by the same failures a developer would see locally.

#### Scenario: A failing suite stops the release

- **GIVEN** a push to the deployment branch whose test suite fails
- **WHEN** the pipeline runs
- **THEN** verification fails and no deployment step touches the production host

#### Scenario: A passing verification releases

- **GIVEN** a push whose checks all pass
- **WHEN** the pipeline runs
- **THEN** the deployment proceeds as it did before this requirement existed

### Requirement: Verification Runs Away From The Production Host

The verification SHALL run on disposable infrastructure with a database created for that run, and SHALL NOT run on the production host.

The suites recreate their schema by dropping every table in the database the ambient environment names. Running them on the production host would therefore destroy production data before the deploy that was meant to update it, so the separation is a safety requirement rather than a matter of convenience.

#### Scenario: The suites never see the production database

- **WHEN** verification runs
- **THEN** it connects to a database created for that run and discarded with it

### Requirement: Verification Catches What A Green Suite Cannot

The verification SHALL apply the migrations to an empty database, and SHALL boot the real dependency-injection container against the database those migrations produced.

Both exist for failures the suites are structurally blind to. The suites build their schema from the entities while production builds it from the migrations, so a migration that omits what an entity gained passes every spec and fails on the server with the database partly moved. And every spec constructs its services directly, so a provider the container cannot resolve passes the whole suite and throws at startup — after the running process has already been stopped.

#### Scenario: A migration that lags its entities is caught before the server sees it

- **GIVEN** a migration that does not produce the schema the entities describe
- **WHEN** verification applies the migrations to an empty database
- **THEN** the failure is reported and no deployment step runs

#### Scenario: An unresolvable provider is caught before the API is restarted

- **GIVEN** a provider the dependency container cannot resolve
- **WHEN** verification boots the container
- **THEN** the failure is reported and no deployment step runs
