import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbAvailable, initTestOrm } from '../../test/test-orm';
import { inTransaction, lockForUpdate } from './unit-of-work';
import type { MikroORM } from '@mikro-orm/postgresql';

// Stands in for doc_running_number / a budget row: the single row that concurrent
// requests must serialize on. This is the pattern every numbering/reservation
// endpoint MUST follow (CLAUDE.md concurrency rules; invariant 7).
@Entity({ tableName: 'test_counter' })
class TestCounter {
  @PrimaryKey()
  id!: number;

  @Property({ type: 'int' })
  value!: number;
}

const hasDb = await dbAvailable();

describe.skipIf(!hasDb)('pessimistic-lock concurrency (DB-backed)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await initTestOrm([TestCounter]);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    em.create(TestCounter, { id: 1, value: 0 });
    await em.flush();
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('serializes concurrent increments under SELECT FOR UPDATE (no lost updates)', async () => {
    const CONCURRENCY = 20;

    const bump = () =>
      inTransaction(orm.em.fork(), async (tem) => {
        const row = await lockForUpdate(tem, TestCounter, { id: 1 });
        row!.value += 1;
        // flush happens at the end of the transactional block
      });

    await Promise.all(Array.from({ length: CONCURRENCY }, bump));

    const final = await orm.em.fork().findOneOrFail(TestCounter, { id: 1 });
    // Without the lock, racing read-modify-write would lose updates (< 20).
    expect(final.value).toBe(CONCURRENCY);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[pessimistic-lock] no database reachable — skipping DB-backed spec');
}
