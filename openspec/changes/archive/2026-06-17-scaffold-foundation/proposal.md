## Why

The repository currently contains only the default NestJS and Vite/Vue starter
templates — no database layer, no auth, no shared conventions. Before any of the
nine domain capabilities (multi-company → notifications) can be implemented, the
project needs a foundation that already encodes the non-negotiable invariants:
company-scoped data, append-only ledgers, decimal money, pessimistic locking, and
permission-code authorization. This change scaffolds that foundation so every later
slice plugs into the same skeleton instead of re-deciding infrastructure each time.

## What Changes

- **Backend wiring**: Add MikroORM (PostgreSQL driver) to the existing NestJS app,
  with a `MikroOrmModule` configured for `decimal` money handling, a migrations
  setup, and a CLI config (`mikro-orm.config.ts`) plus seeding hook.
- **Entities from the DBML**: Generate a MikroORM entity for **all 37 tables** in
  `erp_approval_system.dbml`, plus the 5 enums (`doc_status`, `budget_txn_type`,
  `doc_category`, `approve_action`, `control_policy`), with exact table/column names,
  FK relations per the `Ref:` lines, money columns mapped as `type: 'decimal'`
  (carried as string), and a generated initial migration that matches the schema.
- **Cross-cutting backend scaffolding** (skeletons, not domain logic): JWT auth module
  carrying active-company context + permission codes; a `@RequirePermissions()` guard
  authorizing on permission **codes**; a `CompanyScope` mechanism to filter every query
  by `company_id`; a `Money`/decimal helper; global `ValidationPipe` + `ParseUUIDPipe`
  convention; standard exception/response shape.
- **Test tooling**: Switch the backend test runner from Jest to **Vitest** (per config),
  add a Playwright e2e harness, and a DB-backed test setup.
- **Frontend wiring**: Add PrimeVue 4 (Aura preset, `.dark` selector), PrimeIcons,
  Tailwind + `tailwindcss-primeui`, `@primevue/forms` + Zod (`zodResolver`), Pinia,
  Vue Router, and a typed API client that attaches the company-context JWT. Provide an
  active-company / permissions Pinia store and a permission-code UI guard helper.
- **Shared schema seam**: Establish a `shared/` location for Zod schemas so client and
  server validation share one source of truth.
- **Local dev**: `docker-compose` for PostgreSQL + MinIO, `.env.example`, and README
  run instructions for both apps.

No domain behavior (budgets, workflows, documents) is implemented here — only the
skeleton and the entity/migration layer those slices will build on.

## Capabilities

### New Capabilities
- `platform-foundation`: The buildable project skeleton — ORM + entities matching the
  canonical DBML, auth/permission-code guard, company-scope filtering, decimal-money
  handling, test tooling, and the frontend UI/forms/state baseline. Defines the
  verifiable requirements the scaffold must satisfy so later capability slices inherit
  the invariants by construction.

### Modified Capabilities
<!-- None. This change adds infrastructure only; it does not alter the requirements
     of any of the nine domain capabilities. Their spec.md files are untouched. -->

## Impact

- **Affected capabilities**: foundational to all nine (multi-company, rbac,
  master-data, multi-currency, budget-control, quota-management, document-engine,
  approval-workflow, notifications) — none of their requirements change.
- **Invariant risk**: This scaffold is where invariants 1 (company isolation), 2
  (append-only ledgers), 6 (permission codes), and 7 (SELECT FOR UPDATE numbering) are
  given their enforcement seams. Getting the seams wrong here propagates everywhere, so
  the entities for `budget_txn`/`approval_log` must be modeled append-only and money
  columns must never be JS numbers.
- **Code**: `back/` (package.json deps, `src/` modules, `mikro-orm.config.ts`,
  `migrations/`, test config), `front-end/` (package.json deps, `src/` plugins, router,
  stores, api client), new root `shared/`, `docker-compose.yml`, `.env.example`.
- **Dependencies added**: `@mikro-orm/*`, `@nestjs/jwt`, `@nestjs/passport`,
  `class-validator`, `vitest`, `@playwright/test` (backend); `primevue`,
  `@primevue/forms`, `@primevue/themes`, `primeicons`, `tailwindcss`,
  `tailwindcss-primeui`, `zod`, `pinia`, `vue-router` (frontend).
- **Tooling**: backend test runner changes Jest → Vitest.
