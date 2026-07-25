## 1. Establish what the pipeline currently reports

- [ ] 1.1 Read the last few runs of the "Deploy Backend" workflow (`gh run list --workflow
  deploy.yml`, then `gh run view <id> --log`) and record which of them reported success while a
  build or migration step had in fact failed. This is the before-picture; without it, the first
  red run after this change looks like the change broke the deploy.
- [ ] 1.2 Confirm on the production host — or from a run log — whether `front-end/dist` is older
  than the running API build, which is what the swallowed `vue-tsc` failure would have caused.
  Record the finding; it decides how urgently the frontend needs a good deploy after this lands.

## 2. Make the remote script stop on failure

- [x] 2.1 Add `set -euo pipefail` as the first line inside the heredoc in
  `.github/workflows/deploy.yml`.
- [x] 2.2 Rewrite the nvm line so a missing nvm fails where it happens. Today's
  `[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"` does NOT abort under `-e` — bash ignores a
  failure inside a `&&` list unless it is the list's last command — so the script continues
  without node on `PATH` and dies later at `pnpm install` with `pnpm: command not found`. Make it
  an explicit `if [ -s … ]; then . …; else echo "nvm not found at …" >&2; exit 1; fi`, so the
  failure names its own cause.
- [x] 2.3 Read the remaining lines for anything else that would trip `-u` or `-e` for a reason
  unrelated to a real failure, and fix only those.

## 3. Stop the other places the workflow hides failure

- [x] 3.1 Change the "Verify key" step to `ssh-keygen -y -f ~/.ssh/id_ed25519 | ssh-keygen -lf -`
  with no `&& echo … || echo …`, so a broken key fails that step.
- [x] 3.2 Change `pnpm install` to `pnpm install --frozen-lockfile`. Do not add `--prod`: the
  migration step needs devDependencies, because the MikroORM CLI runs with `useTsNode: true` and
  reads `src/mikro-orm.config.ts` and `src/migrations/*.ts` directly.

## 4. Stop deploys from racing each other

- [x] 4.1 Add a `concurrency` block at the workflow level with a fixed group (e.g.
  `deploy-production`) and `cancel-in-progress: false`, so a second deploy queues rather than
  cancelling one that may be mid-migration.

## 5. Make the workflow usable and honestly named

- [x] 5.1 Add `workflow_dispatch` alongside the existing `push` trigger.
- [x] 5.2 Rename the workflow from "Deploy Backend" to a name that admits it also builds and
  publishes the web app.

## 6. Verify

- [x] 6.1 Lint the YAML (`actionlint`, or `gh workflow view` after pushing to a branch) and
  confirm it parses.
- [x] 6.2 Dry-run the remote script's failure behaviour without touching production: run the same
  `set -euo pipefail` block locally against a scratch directory with a command forced to fail in
  the middle, and confirm the later commands do not run and the shell exits non-zero.
- [ ] 6.3 Trigger the deploy once via `workflow_dispatch` and confirm the run's status now
  reflects the whole script. Expect this first run to FAIL at the frontend build if `master` still
  has the `vue-tsc` errors — that is the change working, not the change breaking. Record the
  outcome either way.
- [ ] 6.4 If it failed for that reason, merge the typecheck repair (already on the `attendance`
  branch) and re-run, confirming a green run now means every step passed.
