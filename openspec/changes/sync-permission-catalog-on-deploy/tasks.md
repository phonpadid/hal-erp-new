## 1. Find out how big the gap already is

- [ ] 1.1 Before changing anything, run the comparison by hand against the production database:
  take the codes from `allPermissionCodes()` and diff them against `select code from permission`.
  Record which are missing. If codes from slices older than attendance turn up, this has been
  happening for a while and the release note needs to say so.
- [x] 1.2 Do the same against the dev database (`new_erp`), so the difference between the two is
  known before either is touched.

## 2. Lift the catalog out of the seeder

- [x] 2.1 Extract the permission loop at the top of `seedDatabase()` in
  `back/src/seed/seed-data.ts` into an exported `syncPermissionCatalog(em)` that walks
  `allPermissionCodes()`, find-or-creates a `permission` row per code, flushes, and returns the
  code→entity map the rest of `seedDatabase()` already consumes.
- [x] 2.2 Have `seedDatabase()` call it and keep using its return value, so a developer running
  `pnpm seed` sees no change at all.
- [x] 2.3 Confirm the function writes nothing but `permission` rows — no company, user, role, or
  configuration — by reading it, not by assuming: the extraction must not drag along a line that
  belongs to a later section.

## 3. Give it a way to run on its own

- [x] 3.1 Add a script under `back/scripts/` that opens an ORM connection, calls
  `syncPermissionCatalog`, reports how many rows it inserted, and exits zero. Follow the shape of
  `boot-check.ts`: a script, not a spec, because it needs real entity discovery and a live
  database.
- [x] 3.2 Add a read-only counterpart that compares `allPermissionCodes()` with the rows present
  and exits non-zero naming every missing code, zero when complete. It MUST make no writes.
- [x] 3.3 Wire both into `back/package.json` as `permissions:sync` and `permissions:check`.

## 4. Cover the behaviour with tests

- [x] 4.1 Add a DB-backed spec proving `syncPermissionCatalog` inserts the missing codes and
  creates nothing else: count rows in `company`, `app_user`, and `role` before and after, and
  assert they are unchanged.
- [x] 4.2 Add a spec proving a second run inserts nothing (idempotent).
- [x] 4.3 Add a spec proving a `permission` row whose code is no longer declared survives the run
  untouched, together with a `role_permission` grant that references it.
- [x] 4.4 Add a spec for the check: short catalog → non-zero and the missing codes named; complete
  catalog → zero. Keep it deterministic — no dependence on which day it runs.

## 5. Put it in the deploy

- [x] 5.1 In `.github/workflows/deploy.yml`, add `pnpm --filter back permissions:sync` immediately
  after `migration:up`, then `pnpm --filter back permissions:check` after it. Do NOT add
  `seeder:run`.
- [x] 5.2 Confirm the placement is before `pm2 restart`, so a failed check leaves the previous
  process serving rather than restarting into a broken authorization surface.

## 6. Verify

- [x] 6.1 Run `pnpm --filter back permissions:check` against a database deliberately missing a
  code and confirm it exits non-zero and names it.
- [x] 6.2 Run `pnpm --filter back permissions:sync` against that database, then the check again,
  and confirm the second check exits zero.
- [x] 6.3 Run `pnpm --filter back seed` on a scratch database and confirm the seeded result is
  identical to what it produced before the extraction.
- [x] 6.4 Run the full `pnpm --filter back test` and confirm no regression.
- [ ] 6.5 After this deploys, confirm the attendance endpoints are grantable in the RBAC admin
  UI — the codes appearing in `listPermissions` is the observable proof the whole change exists
  to produce. Note that they still need granting to a role before anyone can use them.
