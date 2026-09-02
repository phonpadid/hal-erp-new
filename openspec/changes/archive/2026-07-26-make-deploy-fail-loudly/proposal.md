## Why

`.github/workflows/deploy.yml` reports success when the deploy failed. The remote script runs
eight commands through `ssh … 'bash -s'` with no `set -e` and no `&&`, so every command runs
regardless of what the previous one did, and the job's exit status is the exit status of its last
line — `pm2 restart erp-api-new`. A green check therefore means "pm2 accepted a restart", not
"the deploy worked". `git fetch`, `pnpm install`, `migration:up`, and both builds can all fail
without leaving a mark.

This is not theoretical. `pnpm --filter front-end build` runs `vue-tsc -b && vite build`, and
`vue-tsc` currently fails on `master` — so `vite build` never runs, `front-end/dist` keeps serving
the previous UI, and the API restarts on new code anyway. Nobody found out from the pipeline.

Everything else we want from this pipeline — gating on tests, backing up before migrating, health
checks, rollback — is worth less than nothing while the pipeline lies about the outcome, because
each new check would report the same false green.

## What Changes

- **BREAKING (for the deploy's reported status, not for the product):** the remote script gets
  `set -euo pipefail`, so the first failing command aborts the deploy and the job goes red.
  Deploys that have been "succeeding" while half-failing will start failing visibly. That is the
  point of the change, and it should be expected on the first run.
- A `concurrency` group serialises deploys, so two pushes in quick succession can no longer run
  two deploys against the same checkout — today the second `git reset --hard` can land while the
  first is still building.
- `pnpm install` becomes `pnpm install --frozen-lockfile`, so production installs exactly what the
  lockfile pins rather than re-resolving.
- `workflow_dispatch` is added, so a redeploy no longer requires an empty commit.
- The "Verify key" step stops swallowing its own failure with `|| echo "KEY BROKEN"`; a broken
  key fails the job where it is detected instead of one step later.
- The workflow is renamed from "Deploy Backend" to something that admits it also builds the web
  app.

Explicitly NOT in this change: no test gate, no database backup, no health check, no rollback.
Those are the next two changes, and both are easier to design once the pipeline reports honestly.

## Capabilities

### New Capabilities

- `deployment-pipeline`: how a change reaches production — what the pipeline must do, what it must
  refuse to do, and what its reported status is allowed to mean. This change specifies only the
  honesty properties (abort on failure, no concurrent deploys, reproducible installs, manual
  trigger); the gate, backup, health check, and rollback requirements land here in later changes.

### Modified Capabilities

None.

## Impact

- `.github/workflows/deploy.yml` — the only file changed.
- No application code, entity, migration, DTO, endpoint, or permission code is touched, so no
  invariant in CLAUDE.md is affected. Company isolation, the append-only ledgers, the balance
  derivation, and the permission-code guards are all untouched.
- **Operational impact is real and immediate:** the next push to `master` will surface every
  failure the pipeline has been absorbing. The `vue-tsc` failure on `master` is the known one; a
  deploy attempted before that is fixed will now stop at the frontend build instead of restarting
  the API against a stale UI. Whoever merges first should expect to fix forward.
- Anyone reading a green check on an older run should know it did not mean what it appeared to
  mean.
