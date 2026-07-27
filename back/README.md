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

## Database / migrations

```bash
pnpm migration:create  # new migration from entity changes
pnpm migration:up      # apply pending migrations
pnpm schema:dump       # show the metadata-vs-DB diff (should be empty)
```

The initial migration in `src/migrations/` was generated from the entity metadata;
applying it to an empty database reproduces the DBML schema with an empty diff.

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
