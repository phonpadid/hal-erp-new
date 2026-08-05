import { Seeder } from '@mikro-orm/seeder';
import { seedEssentials } from './seed-essentials';
import { seedDatabase } from './seed-data';
import type { EntityManager } from '@mikro-orm/core';
import type { EntityManager as PostgresEntityManager } from '@mikro-orm/postgresql';

/**
 * Entry point for `mikro-orm seeder:run`.
 *
 * Seeds the ESSENTIALS by default — permissions, currencies, notification templates — because that
 * is the part every environment needs and the part no administrator can create from the product.
 *
 * The demo (a company, org, master data, document configuration, a budget, and ten loginable
 * accounts sharing a password committed to this repository) is **opt-in**, and opting in is refused
 * outright when `NODE_ENV=production`. There is no flag that turns it on there — the point of the
 * guard is that it cannot be argued with at 2am.
 *
 *   mikro-orm seeder:run                    essentials only
 *   SEED_DEMO=true mikro-orm seeder:run     essentials + demo   (never on production)
 *
 * Why a refusal rather than a warning: `seeder:run` is one word away from `migration:up` in a deploy
 * script, and the demo's `upsert` creates whatever it does not find. On a production database
 * missing those usernames it would not "restore" them — it would manufacture ten accounts, with a
 * known password, already marked email-verified, one of them the president in the approval chain.
 */
export class DatabaseSeeder extends Seeder {
  async run(em: EntityManager): Promise<void> {
    const pg = em as unknown as PostgresEntityManager;

    const report = await seedEssentials(pg);

    // eslint-disable-next-line no-console
    console.log(
      `seed: essentials — ${report.permissions} permission codes, ` +
        `${report.currencies} currency row(s) added, ${report.templates} template(s) added`,
    );

    if (!wantsDemo()) {
      // eslint-disable-next-line no-console
      console.log('seed: demo data skipped (set SEED_DEMO=true on a development database)');

      return;
    }

    if (isProduction()) {
      throw new Error(
        'seed: refusing to write demo data — NODE_ENV=production. ' +
          'The demo creates a company, master data and ten accounts sharing a password from this ' +
          'repository. Run without SEED_DEMO to seed the essentials only.',
      );
    }

    await seedDatabase(pg);

    // eslint-disable-next-line no-console
    console.log('seed: demo data written (development only)');
  }
}

function wantsDemo(): boolean {
  return (process.env.SEED_DEMO ?? '').toLowerCase() === 'true';
}

/**
 * Anything that is not explicitly a development or test environment is treated as production.
 *
 * Fail-closed on purpose: an unset `NODE_ENV` is far more likely to be a server nobody configured
 * than a laptop, and the cost of the two mistakes is not symmetric — refusing on a laptop costs one
 * environment variable, allowing on a server costs ten accounts with a published password.
 */
function isProduction(): boolean {
  const env = (process.env.NODE_ENV ?? '').toLowerCase();

  return env !== 'development' && env !== 'test';
}
