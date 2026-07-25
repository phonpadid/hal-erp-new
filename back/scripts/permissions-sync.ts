import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../src/mikro-orm.config';
import { Permission } from '../src/modules/rbac/rbac.entities';
import { declaredPermissionCodes, syncPermissionCatalog } from '../src/seed/seed-data';

/**
 * Reconciles the `permission` table to the codes the guards check, and nothing else.
 *
 * A deploy applies migrations, so a new slice's tables arrive on their own. Its permission codes
 * do not: they live in TypeScript, and a code with no row is invisible to `listPermissions` and
 * rejected by `requirePermissions`, so every endpoint behind it answers 403 with nothing in the
 * product able to fix it. This is the step that closes that gap.
 *
 * Deliberately NOT `seeder:run`. The seeder also creates a demo company, roles, master data,
 * document configuration, and users `admin` / `approver` / `requester` with a password committed
 * to this repository, already marked verified — on any environment missing those usernames it
 * would manufacture them.
 *
 * Additive: rows for codes no longer declared are left alone, grants and all.
 *
 * Run with `pnpm --filter back permissions:sync`. Requires a reachable database.
 */
async function main(): Promise<void> {
  const orm = await MikroORM.init(config);
  try {
    const em = orm.em.fork();
    const before = await em.count(Permission);
    await syncPermissionCatalog(em);
    const after = await em.count(Permission);
    const declared = declaredPermissionCodes().length;
    // eslint-disable-next-line no-console
    console.log(
      `permissions:sync: ${declared} codes declared, ${after - before} row(s) inserted, ${after} in the catalog`,
    );
  } finally {
    await orm.close(true);
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('permissions:sync FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
