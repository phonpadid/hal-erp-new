## Context

The deploy is one SSH invocation carrying a heredoc:

```
ssh $USER@$HOST 'bash -s' << 'EOF'
  export NVM_DIR=…; . nvm.sh
  cd /var/www/erp/erp-$FOLDER
  git fetch origin master
  git reset --hard origin/master
  pnpm install
  pnpm --filter @erp/shared build
  pnpm --filter back migration:up
  pnpm --filter back build
  NODE_OPTIONS="--max-old-space-size=1536" pnpm --filter front-end build
  pm2 restart erp-api-new
EOF
```

Bash without `set -e` runs every line and returns the status of the last one. `ssh` propagates
that status, and GitHub marks the job by it. So the reported outcome is decided entirely by
`pm2 restart`:

```
   what actually happened                     what the pipeline said
   ─────────────────────────────────────────────────────────────────
   everything worked                          ✅
   frontend build failed, API restarted       ✅   ← happening today
   migration:up failed, API restarted         ✅
   pnpm install failed, old deps, restarted   ✅
   git fetch failed, deployed the old commit  ✅
   pm2 restart failed                         ❌
```

Two facts make this worse than a cosmetic problem. First, the steps are ordered so that the
riskiest one — `migration:up` — runs fourth, with five chances to have already failed silently
before it and a `pm2 restart` after it that will report success regardless. Second, `pm2 restart`
returns as soon as pm2 accepts the command, so even a process that crashes on boot leaves a green
check.

`boot:check` exists precisely because a provider Nest cannot resolve passes the whole test suite
and fails at startup — the exact failure `pm2 restart`'s exit code cannot see.

## Goals / Non-Goals

**Goals:**
- The job's status means "every step of the deploy succeeded", with no exceptions.
- A failure stops the deploy at the failing step rather than continuing into the next one.
- Two deploys cannot interleave on the same server checkout.
- Production installs what the lockfile pins.
- A redeploy is possible without an empty commit.

**Non-Goals:**
- Gating on the test suites. That is the next change; it needs `actions/checkout`, a Node
  toolchain, and a Postgres service, none of which this workflow has today (the runner never
  checks out the repo — all work happens over SSH).
- Backing up the database, health-checking after restart, or rolling back. Those need facts about
  the production host this change does not require: whether a health endpoint exists, where nginx
  serves `front-end/dist` from, and whether the disk has room for a dump.
- Changing the order of the deploy steps, or the zero-downtime question raised by running
  `migration:up` before `pm2 restart`. Both are real; neither is an honesty problem.
- Fixing the `vue-tsc` failure on `master`. This change makes it visible; a separate change fixes
  it. (The repair already landed on the `attendance` branch and will arrive with that merge.)

## Decisions

**`set -euo pipefail`, not `set -e` alone.**
`-e` aborts on a failing command; `-o pipefail` makes a pipeline fail when any stage fails, not
just the last; `-u` turns an unset variable into an error rather than an empty string — which
matters in a script whose paths are built from `secrets.FOLDER_NAME`, where an empty expansion
would `cd /var/www/erp/erp-` and then `git reset --hard` in whatever directory that resolves to.

*Alternative — chain the commands with `&&`.* Rejected: it produces one unreadable line, and it
is easy to add a step later and forget the `&&`, which silently restores today's behaviour.
`set -e` is a property of the script rather than a property of how it was typed.

**Make the missing-nvm case fail where it happens.** The current line is
`[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"`.

An earlier draft of this design claimed `set -e` would abort on that line when the file is
missing. That is wrong, and a dry run proved it: bash does not exit on a command that fails inside
a `&&` list unless it is the list's last command, so `[ -s … ]` failing short-circuits the list
and execution continues. Verified directly — `bash -c 'set -e; false && echo x; echo still-here'`
prints `still-here`.

The line still needs replacing, for a different reason. Today a missing nvm means node is never
put on `PATH`, the script sails past it, and the deploy dies several lines later at
`pnpm install` with `pnpm: command not found` — a message that describes a symptom three steps
removed from its cause. An explicit `if … else echo … >&2; exit 1; fi` fails at the line that
knows what went wrong. The dry run confirms all three paths: missing nvm exits 1 with the
message, present nvm sources it and continues.

**`concurrency` with `cancel-in-progress: false`.**
Deploys must serialise, not cancel. Cancelling a deploy mid-`migration:up` is exactly the state
nobody can recover from; queuing the second one behind the first is the safe reading of "two
pushes arrived".

**`--frozen-lockfile` rather than `--prod`.**
The server needs devDependencies: `migration:up` runs through the MikroORM CLI with
`useTsNode: true`, reading `src/mikro-orm.config.ts` and `src/migrations/*.ts` directly. Installing
production-only dependencies would break the migration step. `--frozen-lockfile` gets
reproducibility without touching what is installed.

**Fail the key check where it is detected.**
`ssh-keygen … && echo "KEY OK" || echo "KEY BROKEN"` always exits zero. Dropping the `|| echo`
lets the step fail on a broken key, which is a clearer message than the deploy step's SSH error.

**No sequence note, transaction boundary, or lock applies.** This change writes no `budget_txn`
or `quota_usage` rows, and touches no application code that could. The only database interaction
in the file is `migration:up`, whose behaviour is unchanged — it merely becomes able to stop the
deploy when it fails.

## Risks / Trade-offs

**The first run after this merges will probably fail** — `vue-tsc` fails on `master` today, so the
deploy will now stop at the frontend build instead of restarting the API → this is the intended
behaviour and the reason the change exists; the typecheck repair is already on the `attendance`
branch, so merging that first turns the first honest run green.

**A deploy that stops halfway leaves the server in a mixed state** — new code checked out, maybe
migrated, old process still running → strictly better than today, where the same mixed state
happens *and* the API is restarted on top of it and the pipeline says it went fine. Rollback is
change C's job; visibility has to come first.

**`set -u` could abort on a variable that has always been empty in practice** → the only expansions
in the script are `NVM_DIR` (set on the line above) and the GitHub-side `secrets.FOLDER_NAME`,
which is substituted before bash ever sees it; an empty secret is a configuration error that
should stop the deploy, which is what `-u` will now do.

**Serialising deploys makes a queued deploy wait** → deploys take about two minutes and are
infrequent; a queue of two is not a cost worth optimising against a `git reset --hard` landing
mid-build.

**Nobody may notice the pipeline is now honest** → the change is only useful if a red check is
acted on; if red deploys get ignored the way the silent failures were, nothing has improved. Worth
saying out loud to whoever watches the repo when this lands.
