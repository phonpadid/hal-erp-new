import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbAvailable, initTestOrm } from '../../test/test-orm';
import type { MikroORM } from '@mikro-orm/postgresql';

@Entity({ tableName: 'test_money' })
class TestMoney {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'decimal', precision: 15, scale: 2 })
  amount!: string;
}

const hasDb = await dbAvailable();

describe.skipIf(!hasDb)('decimal money round-trip (DB-backed)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await initTestOrm([TestMoney]);
    await orm.schema.refreshDatabase();
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('persists and re-reads "1234567.89" as the exact string, never a float', async () => {
    const em = orm.em.fork();
    const row = em.create(TestMoney, { amount: '1234567.89' });
    await em.persistAndFlush(row);
    em.clear();

    const reloaded = await em.findOneOrFail(TestMoney, { id: row.id });
    expect(typeof reloaded.amount).toBe('string');
    expect(reloaded.amount).toBe('1234567.89');
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[decimal-roundtrip] no database reachable — skipping DB-backed spec');
}
