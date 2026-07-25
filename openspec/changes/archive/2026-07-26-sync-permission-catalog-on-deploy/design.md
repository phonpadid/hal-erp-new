## Context

Three facts, each verified against the code, define the problem.

**The catalog has exactly one writer.** `permission` rows are created only by the loop at the top of `seedDatabase()`, which walks `allPermissionCodes()` and find-or-creates a row per code. Nothing else inserts into that table — no migration, no startup hook. Grepping for `OnModuleInit` and `onApplicationBootstrap` across the backend returns nothing.

**A missing row is unrecoverable through the product.** `listPermissions` pages over `Permission` rows with `isActive: true`, so a code with no row cannot be seen; `requirePermissions` resolves codes to rows before any write and throws `Unknown permission code(s): …` when one is missing, so it cannot be granted blind either. There is no admin screen that inserts into the catalog.

**The deploy never seeds.** The workflow runs fetch, install, builds, `migration:up`, and `pm2 restart`. Adding `seeder:run` to it is not an option: the seeder also creates a demo company, roles, master data, document configuration, a chart of accounts, and users `admin` / `approver` / `requester` with `DEMO_PASSWORD` and `emailVerifiedAt` already set.

```
   what ships                     what production can do with it
   ──────────────────────────────────────────────────────────────
   @RequirePermissions(ATTEND_*)  → guard demands a code…
   migrations create the tables   → …the data is there…
   the web views ship             → …the screens are there…
   permission table               → …but the code is not in it
                                     └─ not listable, not grantable → 403 forever
```

The catalog is a closed set declared in TypeScript and referenced by decorators. It is not configuration a customer edits, and it is not schema. It sits in the gap between them, which is exactly why nothing in the pipeline owns it.

## Goals / Non-Goals

**Goals:**
- Every code the application declares exists as a row in the environment it runs in.
- Reconciling the catalog cannot create anything else — no company, no user, no document type.
- A deploy that has not reconciled the catalog fails loudly rather than serving 403s.
- Developers keep running one command (`seed`) and get the same result they get today.

**Non-Goals:**
- Splitting the rest of `seed-data.ts` into catalog and demo data. Currencies and notification templates are genuinely ambiguous — reference data on one reading, customer-editable configuration on another — and deciding them is not needed to fix this.
- Deactivating or deleting rows for codes no longer declared. Chosen deliberately; see Decisions.
- Wiring the demo seeder into any deployment.
- Backfilling grants. Creating the row makes a code grantable; deciding which roles get it stays an administrator's job, as it is today.

## Decisions

**Extract, do not duplicate.** The loop at the top of `seedDatabase()` depends on nothing below it — it builds `permByCode` from `allPermissionCodes()` and the rest of the function consumes that map. Lifting it into `syncPermissionCatalog(em)` and having `seedDatabase()` call it keeps one source of truth and leaves the seeder's behaviour byte-identical.

*Alternative — insert permission rows from migrations.* Rejected. It reads well (versioned, ordered, already run by the deploy) but it requires transcribing the code list into SQL by hand, which relocates the failure rather than removing it: forget a code in a migration and the migration still succeeds, so the same 403 arrives with less trace. The list in `permissions.ts` is the truth; the database should be *reconciled to it*, not a hand-copied replica of it.

*Alternative — sync on application startup.* Rejected. It makes every boot a schema-adjacent writer, races when several instances start together, and hides the moment the change happened. A deploy step happens once, in order, with a log line.

**Additive only, this time.** A code dropped from the source keeps its row. The alternative — setting `isActive = false` on orphans — is attractive because `listPermissions` already filters on that flag, so a deactivated code would vanish from the admin UI without breaking the `role_permission` rows that reference it. It is rejected for now because it turns the sync from an appender into a writer of existing rows, which is a materially larger claim to make about a command that runs unattended on production. The stale row costs a line in a list nobody grants from; the bug being fixed costs a feature. Worth revisiting once the sync has run uneventfully a few times.

**A separate check, not a flag on the sync.** `permissions:check` is its own command that only reads. It can run in a deploy after the sync as a belt-and-braces assertion, in CI without a writable database, or by hand to answer "what is this environment missing?" — a question worth being able to ask without changing anything. It exits non-zero and prints the missing codes, in the shape `boot-check.ts` established for this class of guard.

**Sync before check, both before restart.** Order matters: reconcile, verify, then restart. Under the `set -euo pipefail` the deploy is gaining, a failed check stops the deploy with the old process still serving — the correct failure, because an application whose catalog is short is worse than one running slightly stale code.

**No transaction boundary or lock is needed.** This writes no `budget_txn` or `quota_usage` rows and no ledger of any kind. The catalog write is a set of independent find-or-create inserts on `permission`, each keyed by a unique `code`; concurrent runs are prevented anyway by the deploy's `concurrency` group, and the unique key makes a double insert an error rather than a duplicate.

## Risks / Trade-offs

**The first production run inserts an unknown number of codes** — it may reveal that earlier slices have been missing codes for weeks, which is information, not damage → the check command run before the sync tells you the size of the gap first; task 1 does exactly that.

**Adding a row makes a code grantable, not granted** — anyone expecting attendance to work immediately after deploy will still see 403 until an administrator grants the new codes to roles → worth saying explicitly in the release note; the alternative (auto-granting to some role) would be the pipeline making an authorization decision, which it must not.

**`seed-data.ts` keeps its split personality** — this change lifts one clean piece out and leaves 1000 lines that still mix reference and sample data → accepted; the remaining ambiguity (currencies, notification templates) deserves its own conversation rather than being resolved silently here.

**A stale row for a removed code stays grantable** — an administrator could grant a permission the application no longer enforces → harmless in effect (nothing checks it) but confusing in the UI; revisit with the deactivation option once this has bedded in.

**The check could pass while the app is still broken for other reasons** — the catalog is one of at least three things production has that tests do not (the others: schema built from migrations rather than entities, and a real DI container) → this closes one; `boot:check` covers another; migration-versus-entity drift remains unguarded and is worth its own change.
