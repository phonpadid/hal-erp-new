## ADDED Requirements

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
