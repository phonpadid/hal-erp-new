## Context

The repo holds two untouched starter apps: `back/` (default NestJS, Jest) and
`front-end/` (default Vite + Vue 3, no UI kit). The canonical data model already
exists as `erp_approval_system.dbml` (37 tables, 5 enums, ~80 `Ref:` relations). Nine
domain capabilities will be built on top of this, in the order multi-company → rbac →
master-data → multi-currency → budget-control → quota-management → document-engine →
approval-workflow → notifications. None can start cleanly until the persistence layer,
auth/permission seam, company-scope seam, and the frontend baseline exist.

This change builds that skeleton. It is deliberately "wiring + entities + seams", not
business logic — the invariants are expressed as enforcement *mechanisms* that later
slices fill in, not as implemented document flows.

Constraints carried from `CLAUDE.md` / `config.yaml`: money is decimal/string only;
`budget_txn` and `approval_log` are append-only; queries filter by `company_id`;
authorization is on permission codes; document numbering and budget reservation use
`SELECT FOR UPDATE`; FX rates lock onto documents at submit.

## Goals / Non-Goals

**Goals:**
- A backend that boots, connects to PostgreSQL via MikroORM, and exposes all 37 tables
  as entities matching the DBML, with a generated initial migration.
- Reusable cross-cutting seams: JWT auth (active company + permission codes), a
  permission-code guard, a company-scope filter, decimal-money mapping, append-only
  ledger access, global validation.
- Vitest + Playwright test harnesses replacing Jest.
- A frontend baseline: PrimeVue 4 (Aura, `.dark`), PrimeIcons, Tailwind +
  tailwindcss-primeui, `@primevue/forms` + Zod, Pinia, Vue Router, typed API client.
- A `shared/` seam for Zod schemas, plus docker-compose (PostgreSQL + MinIO) and docs.

**Non-Goals:**
- No domain business logic: no reserve/actual/release, no workflow engine, no document
  numbering algorithm, no post-actions. Only the entities and the seams those will use.
- No real authentication provider, user store seeding beyond a smoke fixture, or
  production deployment concerns.
- No exhaustive UI screens — one sample form proving the forms+Zod+permission path.
- Not changing the DBML or any of the nine existing capability specs.

## Decisions

### D1 — Generate entities once from the DBML, then own them by hand
MikroORM's `EntityGenerator` reads from a live database, not from DBML. Approach:
(a) translate the DBML to SQL DDL and load it into a throwaway Postgres, run the
generator, then hand-correct; **or** (b) hand-author entities directly from the DBML.
We choose **(b) hand-author**, organized per future capability module
(`multi-company`, `rbac`, `budget`, `quota`, `document`, `approval`, `currency`,
`master-data`, `notification`), because the entities must carry semantics the
generator can't infer: decimal mapping, enum types, append-only intent, relation
naming. Tasks will group the 37 entities by these modules. After authoring,
`mikro-orm migration:create --initial` generates the migration; `schema:update --dump`
must show no diff (verifies spec requirement "Migration reproduces the schema").

*Alternative rejected:* generator-from-DB as the source of truth — it would re-emit
`number` for decimals and lose the append-only/enum intent, requiring as much hand-fix.

### D2 — Money as `type: 'decimal'`, carried as `string`
Every `decimal(p,s)` column in the DBML (`amount_total`, `budget_txn.amount`,
`budget_movement.amount`, `quota.limit_value`, `quota_usage.qty_used`,
`document_line.*`, `exchange_rate.rate` at `decimal(18,8)`, etc.) maps to
`@Property({ type: 'decimal', precision, scale })` typed `string`. We disable JS-number
coercion. A shared `Money` helper wraps add/compare using a decimal library so services
never reach for `+`. This directly satisfies invariant 3 / the decimal spec requirement.

### D3 — Append-only ledgers enforced at the repository seam
`BudgetTxn` and `ApprovalLog` get dedicated repositories exposing only `insert`/read,
no `update`/`remove`. A MikroORM `onFlush`/`beforeUpdate`+`beforeDelete` subscriber
throws if a managed entity of either type is scheduled for update or delete. Belt and
suspenders: the seam plus the subscriber. Later, a DB trigger/grant can harden this,
but the app-level guard is the spec-tested boundary.

### D4 — Company scope via a request-context filter
Active `company_id` lives in an `AsyncLocalStorage`-backed `RequestContext` populated
from the JWT. Company-owned entities are tagged (a marker/base class or a metadata
list), and a MikroORM global filter `@Filter({ name: 'company', ... })` is enabled with
the active company by default. GROUP-scope reads explicitly disable the filter and are
read-only. Writes assert the row's `company_id` equals the active company. This is the
seam for invariant 1; per-capability services opt their entities in.

### D5 — Authorization on permission codes
`AuthModule` (`@nestjs/jwt` + passport-jwt) validates a token whose payload is
`{ sub, companyId, permissions: string[] }`. A `@RequirePermissions('DOC_PR_APPROVE')`
decorator + `PermissionsGuard` checks codes against the token, never role names
(invariant 6). Role→permission resolution is a future rbac concern; the guard only
reads codes from the validated token here.

### D6 — Concurrency primitives provided, not yet used
We add helpers/conventions for `em.transactional()` units of work and
`LockMode.PESSIMISTIC_WRITE`, plus a documented pattern and one illustrative locked
counter test, so budget-control and document-engine inherit the pattern (invariants 4,
7; concurrency rules in CLAUDE.md). No real numbering/reservation logic ships here.

### D7 — Vitest + Playwright over Jest
Replace Jest config/deps with Vitest (`vitest.config.ts`, swc/esbuild transform) and
add `@playwright/test` for e2e. The `test` script runs Vitest. A sample unit test and a
sample e2e keep both harnesses verifiable. Rationale: config.yaml mandates Vitest;
keeping Jest would drift from the stated stack.

### D8 — Frontend baseline wiring
`main.ts` installs PrimeVue with `theme: { preset: Aura, options: { darkModeSelector:
'.dark' } }`, PrimeIcons CSS, Pinia, and Vue Router. Tailwind configured with the
`tailwindcss-primeui` plugin; `style.css` uses theme tokens only. A `useAuthStore`
(Pinia) holds active company + permission codes; a `v-can` / `can(code)` helper gates
affordances (UX only — server still enforces, invariant 6). The API client (axios or
fetch wrapper) attaches the company-context JWT on every request. One sample
`@primevue/forms` form with `zodResolver` proves the validation path.

### D9 — Shared Zod schemas in `shared/`
A root `shared/` workspace package exports Zod schemas. Backend DTOs derive from them
(e.g. via `nestjs-zod` or by inferring types + a class-validator mirror) and frontend
forms import the same schemas, so client/server rules cannot drift. For the scaffold we
ship the seam + one shared schema consumed on both ends.

## Risks / Trade-offs

- **Hand-authored entities can drift from the DBML** → Mitigate with the
  "migration diff is empty" check (D1) as an acceptance gate, and a checklist of all 37
  tables + ~80 refs in tasks.md so none are missed.
- **Global company filter forgotten on a new entity** → Mitigate with a shared base
  class / marker so opting-in is explicit and reviewable; GROUP reads must consciously
  disable the filter. Per-capability concurrency/scope tests will catch leaks later.
- **Append-only guard only at app layer** → A direct SQL `UPDATE` bypasses it. Accepted
  for the scaffold; note a follow-up to add DB-level revocation/triggers. Spec requirement
  is scoped to "through the app".
- **Switching Jest → Vitest** touches every future test author's muscle memory and the
  existing `app.controller.spec.ts` → Mitigate by porting the sample spec and documenting
  the runner in the README.
- **Monorepo `shared/` wiring** (pnpm workspace across `back`, `front-end`, `shared`)
  adds setup cost → Keep it minimal: a single package referenced by path; defer
  publishing/build tooling.
- **`@primevue/forms` is relatively new** → Pin versions and keep the sample form small;
  the resolver API is the only surface we depend on.

## Migration Plan

1. Backend deps + MikroORM config + docker-compose (Postgres/MinIO) + `.env.example`.
2. Author all 37 entities + 5 enums grouped by capability module; wire
   `MikroOrmModule.forRoot`.
3. `migration:create --initial`; verify `schema:update --dump` is empty.
4. Add seams: RequestContext/company filter, auth + permissions guard, append-only
   repos/subscriber, money helper, global ValidationPipe/ParseUUIDPipe.
5. Swap Jest → Vitest; add Playwright; port sample tests.
6. Frontend: install PrimeVue/Tailwind/Pinia/Router/forms/Zod; wire `main.ts`, store,
   api client, sample form; verify light/dark.
7. `shared/` package + one shared schema consumed both sides.
8. README run instructions for both apps.

Rollback: the change is additive scaffolding on starter templates; reverting the
branch restores the starters. No data migration risk (fresh DB).

## Open Questions

- Decimal library choice for the `Money` helper (`decimal.js` vs `big.js`) — pick one in
  tasks; either satisfies the precision requirement.
- pnpm workspace vs npm workspaces for `shared/` — lockfiles already use pnpm in both
  apps, so default to a pnpm workspace unless the user prefers otherwise.
- Whether to derive backend DTOs from Zod via `nestjs-zod` or keep class-validator DTOs
  mirroring the Zod schema — default to `nestjs-zod` for true single-source, fall back to
  mirrored class-validator if it conflicts with the class-validator mandate.
