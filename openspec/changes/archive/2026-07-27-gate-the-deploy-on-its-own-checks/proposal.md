## Why

The pipeline had no gate. A push to master with a failing suite, an unresolvable provider, or a
migration that no longer matched its entities went straight through `migration:up` to
`pm2 restart`, and the first sign of trouble was an API that would not come back up.

Earlier work made the deploy honest about failing — `set -euo pipefail`, a real check for nvm, no
concurrent runs. That makes a bad deploy stop halfway instead of reporting success. It does not
stop a bad deploy from starting.

Two of the failures worth catching are ones a green suite genuinely cannot see:

- The suites build their schema from the **entities**; production builds it from the
  **migrations**. A migration that never learned about a column an entity gained passes every
  spec and fails on the server, mid-deploy, with the database half-moved. This has already
  happened twice in this repo.
- Every spec constructs its services by hand, so the Nest container is never exercised. A provider
  it cannot resolve passes the entire suite and throws at startup — after `pm2 restart` has
  already stopped the running API.

## What Changes

- A `verify` job runs before anything is deployed, on the runner, against a throwaway Postgres.
  `deploy` waits on it.
- It runs four checks: the backend suite, the migrations against an **empty** database, the real
  dependency container booted against that just-migrated database, and the frontend typecheck and
  suite.
- The suites SHALL NOT run on the production host. They call `refreshDatabase()`, which drops and
  recreates every table in whatever database the ambient environment names — on that host, the
  production one.

The deploy steps themselves are unchanged. This change decides only whether they run.

## Capabilities

### Modified Capabilities

- `deployment-pipeline`: new requirements that a deploy is gated on checks that pass first, that
  those checks run away from the production host, and that they include the two failures a green
  suite cannot see.

### New Capabilities

None.

## Impact

- `.github/workflows/deploy.yml` — one new job; the existing job gains `needs`.
- No application code, no migration, no spec-bearing behaviour change.
- Deploys become slower by the length of the checks, and a red suite now blocks a release. That is
  the intent, not a side effect.
