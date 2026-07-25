## Why

Every permission code the application enforces is declared in code — `@RequirePermissions(P.ATTEND_PERIOD_READ)` — but a code is only grantable if a matching row exists in the `permission` table, and those rows come from exactly one place: the demo seeder. The deploy workflow never runs it, and nothing syncs the catalog at startup.

So a slice that adds permission codes ships to production with its endpoints unreachable. `listPermissions` reads the table, so the new codes never appear in the RBAC admin UI; granting one by code is rejected outright with `Unknown permission code(s): …`. The feature is deployed, migrated, built, and running — and returns 403 to everyone including the administrator, with no way to fix it through the product.

Merging the attendance work makes this concrete: 8 migrations will create 14 attendance tables on production, and every `ATTEND_*` endpoint behind them will be unreachable until someone runs the seeder by hand on the server. No test can catch this, because tests build their own database and seed it every run — in the test world the catalog is always complete.

## What Changes

- Extract the permission-catalog loop that already stands alone at the top of `seedDatabase()` into `syncPermissionCatalog(em)`: additive, idempotent, and touching only the `permission` table. `seedDatabase()` calls it, so nothing changes for a developer running the seeder.
- Add `pnpm --filter back permissions:sync`, which runs that function and nothing else. It cannot create a company, a user, a document type, or any other row the demo seeder would manufacture.
- Add `pnpm --filter back permissions:check`, which compares `allPermissionCodes()` against the rows in `permission` and exits non-zero listing whatever is missing. A forgotten sync becomes a failed deploy instead of a 403 nobody can explain.
- Run both in `.github/workflows/deploy.yml`: sync after `migration:up`, check after it, so the deploy stops before restarting if the catalog is still short.

Deliberately **additive only**: a code removed from the source leaves its row in place. Deactivating orphans is a real question, but it makes the sync a writer of existing rows rather than an appender, and the cost of a stale row is a line in an admin list — far below the cost of the bug being fixed here.

The demo seeder is NOT wired into the deploy. It creates `admin`, `approver`, and `requester` with a password committed to this repo, pre-verified and immediately loginable; on any environment missing those usernames it would manufacture them. This change deliberately takes the one piece of that file which is catalog rather than sample data.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `rbac`: a new requirement that the permission catalog in the database matches the codes the application declares, with a command to reconcile it and a command that fails when it does not.
- `deployment-pipeline`: a new requirement that a deploy reconciles the catalog before restarting the application, and refuses to restart when it cannot. (This capability is introduced by the `make-deploy-fail-loudly` change; if that change is still active, this delta stacks on top of it.)

## Impact

- `back/src/seed/seed-data.ts` — the catalog loop becomes an exported function; `seedDatabase()` calls it. No behaviour change for existing callers.
- `back/package.json` — two scripts.
- `back/scripts/` — the check, alongside the existing `boot-check.ts`, which guards the same class of problem: something production does that no spec exercises.
- `.github/workflows/deploy.yml` — two steps between `migration:up` and `pm2 restart`.
- No entity, migration, DTO, endpoint, or permission-code declaration changes. No invariant in CLAUDE.md is affected: company isolation, the append-only ledgers, the balance derivation, and permission-code authorization all keep working exactly as they do — this change only makes sure the codes those guards name actually exist where they are looked up.
- **Operationally:** the first deploy after this lands will insert every code production is currently missing. That set is unknown until it runs and may include codes from earlier slices, not just attendance.
