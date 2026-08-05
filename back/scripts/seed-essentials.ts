import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../src/mikro-orm.config';
import { seedEssentials } from '../src/seed/seed-essentials';

/**
 * Seeds the rows a production database cannot function without, and nothing else.
 *
 * Companion to `permissions:sync`, which does one third of this: a permission code with no row is
 * invisible to `listPermissions` and rejected by `requirePermissions`. The other two thirds fail
 * just as completely and less visibly — a company cannot be created without a currency, and a
 * missing notification template means an approver is simply never told, which from the outside
 * looks like a system that lost the document rather than one that is misconfigured.
 *
 * Safe to run unattended on every deploy: additive, idempotent, and it writes only `permission`,
 * `currency` and `notification_template` rows. It creates no company, no users, no master data.
 *
 * Run with `pnpm --filter back seed:prod`. Requires a reachable database.
 */
async function main(): Promise<void> {
  const orm = await MikroORM.init(config);

  try {
    const report = await seedEssentials(orm.em.fork());

    // eslint-disable-next-line no-console
    console.log(
      `seed:prod: ${report.permissions} permission codes in the catalog, ` +
        `${report.currencies} currency row(s) added, ${report.templates} notification template(s) added`,
    );
  } finally {
    await orm.close(true);
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('seed:prod FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
