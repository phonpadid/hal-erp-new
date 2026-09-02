import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../test/test-orm';
import { Currency } from '../modules/currency/currency.entities';
import { NotificationTemplate } from '../modules/notification/notification.entities';
import { AppUser, Permission } from '../modules/rbac/rbac.entities';
import { Company } from '../modules/multi-company/multi-company.entities';
import { DatabaseSeeder } from './database.seeder';
import { seedEssentials } from './seed-essentials';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The essentials are what a production database needs; the demo is what it must never be given.
 *
 * The distinction is not a preference. `seedDatabase` creates ten accounts sharing a password
 * committed to this repository, already marked email-verified — including the president in the
 * approval chain. On any environment missing those usernames it does not restore them, it
 * manufactures them.
 */
describe.skipIf(!hasDb)('seed-essentials (DB-backed)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  afterEach(() => {
    delete process.env.SEED_DEMO;
    process.env.NODE_ENV = 'test';
  });

  it('seeds the permission catalog, currencies and notification templates', async () => {
    const report = await seedEssentials(orm.em.fork());

    expect(report.permissions).toBeGreaterThan(0);

    const em = orm.em.fork();
    // LAK at zero decimal places is the one that is wrong by default if it is guessed.
    const lak = await em.findOne(Currency, { code: 'LAK' }, FILTER_OFF);
    expect(lak?.decimalPlaces).toBe(0);

    // A missing template is silence, not an error — the approver is simply never told.
    expect(
      await em.findOne(NotificationTemplate, { code: 'DOC_PENDING_APPROVAL' }, FILTER_OFF),
    ).not.toBeNull();
    expect(await em.findOne(NotificationTemplate, { code: 'SLA_OVERDUE' }, FILTER_OFF)).not.toBeNull();
  });

  it('creates no company and no users — that is the whole point', async () => {
    await seedEssentials(orm.em.fork());

    const em = orm.em.fork();
    expect(await em.find(Company, {}, FILTER_OFF)).toHaveLength(0);
    expect(await em.find(AppUser, {}, FILTER_OFF)).toHaveLength(0);
  });

  it('is idempotent — re-running adds nothing', async () => {
    await seedEssentials(orm.em.fork());

    const count = async () => {
      const em = orm.em.fork();

      return {
        perms: (await em.find(Permission, {}, FILTER_OFF)).length,
        currencies: (await em.find(Currency, {}, FILTER_OFF)).length,
        templates: (await em.find(NotificationTemplate, {}, FILTER_OFF)).length,
      };
    };

    const before = await count();
    await seedEssentials(orm.em.fork());
    expect(await count()).toEqual(before);
  });

  it('seeder:run writes the essentials and skips the demo by default', async () => {
    await new DatabaseSeeder().run(orm.em.fork() as never);

    const em = orm.em.fork();
    expect((await em.find(Permission, {}, FILTER_OFF)).length).toBeGreaterThan(0);
    expect(await em.find(AppUser, {}, FILTER_OFF)).toHaveLength(0);
  });

  it('seeder:run REFUSES the demo when NODE_ENV is production', async () => {
    process.env.SEED_DEMO = 'true';
    process.env.NODE_ENV = 'production';

    await expect(new DatabaseSeeder().run(orm.em.fork() as never)).rejects.toThrow(/production/i);

    // And it wrote no accounts on the way to refusing.
    expect(await orm.em.fork().find(AppUser, {}, FILTER_OFF)).toHaveLength(0);
  });

  it('treats an unset NODE_ENV as production — fail closed', async () => {
    process.env.SEED_DEMO = 'true';
    delete process.env.NODE_ENV;

    await expect(new DatabaseSeeder().run(orm.em.fork() as never)).rejects.toThrow(/production/i);

    process.env.NODE_ENV = 'test';
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[seed-essentials] no database reachable — skipping DB-backed spec');
}
