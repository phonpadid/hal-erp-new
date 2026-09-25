# ERP Backend — NestJS + MikroORM + PostgreSQL

Configuration-driven multi-company approval / budget / quota platform. The data
model is `../erp_approval_system.dbml` (75 tables); MikroORM entities live under
`src/modules/<capability>/*.entities.ts` and mirror it exactly.

## Prerequisites

- Node.js 20+ and pnpm
- PostgreSQL 15+ and an S3-compatible store — the repo root `docker-compose.yml`
  provides both (Postgres on 5432, MinIO on 9000/9001).

## Setup

```bash
# from the repo root (pnpm workspace: back, front-end, shared)
pnpm install
pnpm --filter @erp/shared build      # build shared Zod schemas first

# start infra
docker compose up -d                 # postgres + minio

# configure env
cp back/.env.example back/.env       # defaults match docker-compose
```

## Run

```bash
cd back
pnpm migration:up      # apply the initial schema
pnpm seed              # idempotent demo baseline (see below) — safe to re-run
pnpm start:dev         # http://localhost:3000
```

## Demo data & credentials

`pnpm seed` (MikroORM `seeder:run` → `DatabaseSeeder`) loads an idempotent demo baseline:
all permission codes, a `DEMO` company with departments/fiscal year, currencies + a rate,
roles wired to permissions, master data, document types/forms/workflow, a budget + quota,
and notification templates — enough to log in and run a PR end to end.

Demo accounts (all password `demo1234`) — **DEMO ONLY, not for production**:

| Username    | Role        | Can do |
| ----------- | ----------- | ------ |
| `admin`     | Administrator | everything (all permission codes) |
| `approver`  | Approver    | view + approve documents, view budgets |
| `requester` | Requester   | create / submit / cancel documents, view masters |

The seeder is idempotent (upsert by natural key), so re-running it after schema changes is
safe and never duplicates rows.

## First run on production

`seed:prod` writes only what the application resolves by code — permissions, currencies,
notification templates. It creates no company and no account, and the demo seeder above is refused
outright when `NODE_ENV` is production. So a freshly deployed database has nobody who can sign in,
and no way to create one: account creation needs a permission, which needs a token, which needs an
account, and no route is public.

`bootstrap:admin` closes that gap **once, by hand**. It creates one company, an `HQ` department, an
`ADMIN` role holding every active permission code, one account already marked email-verified, and
the membership binding them — all in one transaction. It then refuses to run again: any database
holding an account is rejected, whatever state that account is in.

```bash
pnpm --filter back migration:up
pnpm --filter back seed:prod

# Set the variables from a file or a prompt — NOT inline, or the password lands in shell history.
read -rsp 'admin password: ' BOOTSTRAP_PASSWORD && export BOOTSTRAP_PASSWORD && echo
export BOOTSTRAP_USERNAME=… BOOTSTRAP_EMAIL=… \
       BOOTSTRAP_COMPANY_CODE=… BOOTSTRAP_COMPANY_NAME=… BOOTSTRAP_CURRENCY_CODE=LAK

pnpm --filter back bootstrap:admin
```

| Variable | Required | Notes |
| -------- | -------- | ----- |
| `BOOTSTRAP_USERNAME` | yes | the login name |
| `BOOTSTRAP_EMAIL` | yes | unique across accounts |
| `BOOTSTRAP_PASSWORD` | yes | must pass the product's own policy: ≥8 chars, a letter and a digit |
| `BOOTSTRAP_COMPANY_CODE` | yes | unique; the company's short code |
| `BOOTSTRAP_COMPANY_NAME` | yes | display name |
| `BOOTSTRAP_CURRENCY_CODE` | yes | base currency, e.g. `LAK` — must be an active `currency` row |

Nothing defaults: a default administrator password is a published one. The command reads these only
here; the running application never does.

Then **sign in, change the password through the product, and create real roles** — this account
exists to make properly scoped ones, not to stay as it is. It is deliberately not part of the
deploy, which is asserted by `src/seed/deploy-creates-no-accounts.spec.ts`.

Rollback: delete the six rows the command names in its output; it will then permit a fresh attempt.

## Production host: the builds run here, so give them room

The deploy compiles on the host. Measured peak resident memory for what that asks of it:

| step | peak RSS | wall |
| ---- | -------- | ---- |
| `pnpm --filter front-end bundle` (`vite build`) | **1.02 GB** | 2.9s |
| `pnpm --filter back build` (`nest build`, 697 files, ~116k lines) | **825 MB** | 9.0s |
| `pnpm --filter @erp/shared build` | 316 MB | 1.1s |

This box also runs postgres and the live API. Without swap a deploy dies with nothing but:

```
> nest build
Killed
Exit status 137
```

`137` is `128 + 9` — SIGKILL from the kernel's OOM killer, not a compiler error. No file, no line,
nothing in the repository to fix.

**Swap is load-bearing, not a nicety.** Provision it once, per host:

```bash
sudo fallocate -l 4G /swapfile          # or: sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab   # survives reboot
sudo sysctl -w vm.swappiness=10                              # prefer RAM; swap is headroom, not storage
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf
```

Verify, and confirm the last kill if you are diagnosing one:

```bash
free -h
swapon --show
sudo dmesg | grep -i -E 'killed process|out of memory' | tail -5
```

### Two cheaper fixes that do not work

Recorded so they are not tried again:

- **`--max-old-space-size`** does not bound this. Capping it at 768 MB *raised* peak RSS to 846 MB,
  because tsc's footprint is largely strings and native allocation rather than V8 old-space. The
  idiom that works for `vue-tsc` (the front-end runs `bundle`, not `build`, for that reason) does
  not transfer to `tsc`.
- **swc** is genuinely lighter — `nest build -b swc` runs at 334 MB in 1.7s — but the `dist` it
  emits dies on startup with `ReferenceError: Cannot access 'Company' before initialization`.
  Three entity modules import each other in a cycle that tsc's CommonJS emit tolerates and swc's
  lazy export getters do not. The same smoke test (`node -e "require('./dist/app.module.js')"`)
  passes against the tsc build, so it is a real regression, not a latent defect being surfaced.
  Fix the cycle first and swc becomes available.

### When a build dies mid-deploy

`set -euo pipefail` stops before `pm2 restart`, so the API keeps serving the **old** code from
memory — the running node process holds its files by inode. But `migration:up`, `permissions:sync`
and `seed:prod` have already run, so the database is on the new schema, and `nest-cli.json` sets
`deleteOutDir`, so `back/dist` was emptied before the compile that died. The old process survives;
the next `pm2 restart` or reboot has no build to boot. Recover on the host, once there is swap:

```bash
cd /var/www/erp/erp-<folder>
pnpm install --frozen-lockfile
pnpm --filter @erp/shared build && pnpm --filter back build && pnpm --filter front-end bundle
pm2 restart erp-api-new
```

## Database / migrations

```bash
pnpm migration:create  # new migration from entity changes
pnpm migration:up      # apply pending migrations
pnpm schema:dump       # show the metadata-vs-DB diff — READ THE WARNING BELOW
```

The initial migration in `src/migrations/` was generated from the entity metadata;
applying it to an empty database reproduces the DBML schema.

### Never run `schema:update --run` against a database with data

`schema:dump` is a *diff*, not a to-do list, and this project's diff is **not** empty. Measured on
2026-08-26 it holds 33 destructive statements, because the migrations create things the entity
metadata does not describe: twenty-one hand-written `CHECK` constraints, and partial unique indexes
such as `budget_control_point_*_unique` and `budget_node_fy_code_unique`. MikroORM cannot see them,
so it proposes dropping them:

```
alter table "company" drop constraint company_correction_window_check;
alter table "attendance_period_log" drop constraint if exists "attendance_period_log_action_check";
...
```

Applying that diff would silently remove the rules that keep the ledgers honest, and nothing would
fail until data that should have been refused was already in. **`migration:up` is the only way a
schema changes here**, and it is what the deploy runs. Use `schema:dump` to read what drifted, then
write a migration for it.

`pnpm typecheck:scripts` covers `scripts/` for the same reason: `tsconfig.build.json` excludes that
directory, so `nest build` never looks at it and a type error there surfaces only when `ts-node`
compiles the file — which is to say, in front of whoever is running the command.

The same gap bites in specs: a constraint declared only in a migration does not exist in the
throwaway schema `refreshDatabase()` builds from entity metadata, so a spec can pass against a
database missing the very index it depends on. That is how the resubmit defect of 2026-08-26
survived a green suite. Declare indexes on the entity (`@Index({ expression })`) so both paths
agree, and keep the migration in step.

## Tests

```bash
pnpm test              # Vitest unit + DB-backed specs (DB-backed ones skip if no DB)
pnpm test:e2e          # Playwright e2e (boots the app via webServer)
```

DB-backed specs (decimal round-trip, pessimistic-lock concurrency) read the same
`DB_*` env as the app and skip gracefully when no database is reachable.

## Architecture seams (invariants enforced here)

- **Company scope** (`common/scope`, `CompanyScopedEntity` filter) — every query is
  filtered by the active `company_id`.
- **Append-only ledgers** (`common/ledger`) — `budget_txn` / `approval_log` reject
  update + delete (repository + flush subscriber).
- **Money** (`common/money`) — DECIMAL carried as string; never a JS number.
- **Auth** (`auth/`) — JWT carries `{ sub, companyId, permissions[] }`;
  `@RequirePermissions('CODE')` + `PermissionsGuard` authorize on permission **codes**.
- **Concurrency** (`common/uow`) — `inTransaction()` + `lockForUpdate()`
  (`SELECT FOR UPDATE`) for budget reservation and document numbering.
