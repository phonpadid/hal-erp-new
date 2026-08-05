# Deployment Pipeline Specification

## Purpose
How a change reaches production: what the pipeline must do, what it must refuse to do, and what
its reported status is allowed to mean. The pipeline is the last thing standing between a commit
and a running system, so its honesty is a property worth specifying — a green check that does not
mean "the deploy worked" is worse than no check at all.
## Requirements
### Requirement: A deploy stops at its first failing step

The deploy script SHALL abort at the first command that fails, rather than continuing to the
commands after it. The remote shell SHALL run under `set -euo pipefail`, so that a failing stage
of a pipeline fails the script and an unset variable is an error rather than an empty expansion.
No step SHALL suppress its own failure with a trailing `|| true`, `|| echo`, or equivalent, except
where the design records a reason for tolerating that specific failure.

#### Scenario: The frontend build fails

- **GIVEN** a commit whose `vue-tsc -b` reports a type error
- **WHEN** the deploy reaches the frontend build step
- **THEN** the deploy stops there, the application process is not restarted, and the run is
  reported as failed

#### Scenario: A migration fails

- **WHEN** `migration:up` exits non-zero during a deploy
- **THEN** no later step runs and the run is reported as failed

#### Scenario: A key check fails

- **WHEN** the deployment key cannot be read or verified
- **THEN** the step that verifies it fails, rather than printing a diagnostic and letting the
  deploy proceed

### Requirement: A reported deploy success means every step succeeded

The status the pipeline reports SHALL be determined by every step of the deploy, not by its last
command. A run reported as successful SHALL mean that the checkout, the dependency install, every
build, the migration, and the process restart all succeeded.

#### Scenario: Every step succeeds

- **WHEN** a deploy runs with no failing command
- **THEN** the run is reported as successful

#### Scenario: An early step fails and the restart would have succeeded

- **GIVEN** a deploy in which an earlier step fails while the process manager would accept a
  restart
- **WHEN** the run finishes
- **THEN** it is reported as failed, because the reported status does not come from the restart
  alone

### Requirement: Deploys do not run concurrently

Deploys to a given environment SHALL be serialised, so that no two runs operate on the same
server checkout at the same time. A run that arrives while another is in flight SHALL queue behind
it rather than cancelling it, because a deploy interrupted during a migration leaves state no
later run can reason about.

#### Scenario: Two pushes arrive in quick succession

- **WHEN** a second deploy is triggered while a first is still running
- **THEN** the second waits for the first to finish, and the first is not cancelled

### Requirement: Production installs exactly what the lockfile pins

The dependency install SHALL use the committed lockfile without re-resolving it, so the versions
running in production are the versions the suites ran against. The install SHALL retain
development dependencies, because the migration step runs through the ORM CLI from TypeScript
sources.

#### Scenario: The lockfile and the manifest disagree

- **WHEN** a deploy installs dependencies and the lockfile is out of date with respect to
  `package.json`
- **THEN** the install fails rather than silently resolving different versions

#### Scenario: Migrations run from TypeScript sources

- **WHEN** the deploy runs the migration step
- **THEN** the ORM CLI and its TypeScript loader are present, because the install did not prune
  development dependencies

### Requirement: A deploy can be triggered without a new commit

The pipeline SHALL support triggering a deploy manually, so re-running a deploy does not require
pushing an empty commit.

#### Scenario: A redeploy is needed after fixing the server

- **WHEN** an operator needs to re-run the last deploy
- **THEN** the pipeline can be started manually against the same commit

### Requirement: A deploy reconciles the permission catalog before restarting

The deploy SHALL reconcile the permission catalog after applying migrations and before restarting the application, and SHALL then verify it. A deploy whose catalog verification fails SHALL stop without restarting, leaving the previous process serving, because an application whose authorization codes are absent is worse than one running slightly older code. The step that reconciles SHALL be the catalog-only command, never the demo seeder, which also creates sample companies, roles, and loginable accounts.

No step of the deploy SHALL create a login account, by any command. This covers the demo seeder and the production bootstrap alike: the bootstrap creates an account holding the entire permission catalog, and a pipeline that runs on every push to the default branch is not a place where such an account should be able to come into existence unobserved. Bootstrapping is performed by a person, on the host, once.

#### Scenario: A deploy carries new permission codes

- **GIVEN** a commit that declares permission codes the target environment does not have
- **WHEN** the deploy runs
- **THEN** the codes are inserted after the migrations and before the restart, and the deployed endpoints are grantable

#### Scenario: The catalog is still short after reconciling

- **WHEN** the verification step reports a missing code
- **THEN** the deploy stops there and the running process is not restarted

#### Scenario: Sample data is never deployed

- **WHEN** a deploy reconciles the catalog
- **THEN** no company, department, role, user, master-data, or document-configuration record is created as a side effect

#### Scenario: The deploy cannot bootstrap an administrator

- **WHEN** the deploy runs against an environment holding no `app_user` row
- **THEN** it does not invoke the bootstrap command, and the environment remains without an account until a person runs it

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

