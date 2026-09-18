import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { ScopeService } from '../rbac/scope.service';
import { ItemService } from './item.service';
import { Item, MasterSequence, Vendor } from './master-data.entities';
import { MasterSequenceService } from './master-sequence.service';
import { VendorService } from './vendor.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const asUser = <T>(fn: () => Promise<T>) =>
  RequestContext.run({ userId: 'u1', companyId: 'c1', departmentId: 'd1', grants: [] }, fn);

/**
 * `vendor_code` / `item_code` are issued by the system from a locked group-wide counter, never
 * typed. The counter rows are what the migration seeds — here they are inserted by hand, at the
 * value the migration's seed rule would compute for the legacy rows this suite plants.
 */
describe.skipIf(!hasDb)('master codes are issued by the system (DB-backed)', () => {
  let orm: MikroORM;
  let vendors: VendorService;
  let items: ItemService;

  /** The migration's seed rule: max numeric suffix over codes matching the exact pattern. */
  async function seedCountersLikeTheMigration(): Promise<void> {
    const em = orm.em.fork();
    const [{ v }] = await em.getConnection().execute<{ v: number }[]>(
      `select coalesce(max(substring(vendor_code from 3)::int), 0) as v from vendor where vendor_code ~ '^V-[0-9]+$'`,
    );
    const [{ i }] = await em.getConnection().execute<{ i: number }[]>(
      `select coalesce(max(substring(item_code from 3)::int), 0) as i from item where item_code ~ '^I-[0-9]+$'`,
    );
    await em.nativeDelete(MasterSequence, {});
    em.create(MasterSequence, { kind: 'VENDOR', currentNo: Number(v) });
    em.create(MasterSequence, { kind: 'ITEM', currentNo: Number(i) });
    await em.flush();
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    // Legacy rows: one item already on the pattern, one vendor off it.
    const em = orm.em.fork();
    em.create(Item, { itemCode: 'I-00001', name: 'Legacy paper', isStockTracked: false, isActive: true });
    em.create(Vendor, { vendorCode: 'BANKPICK-DEMO', name: 'Legacy vendor', paymentTermDays: 30, isActive: true });
    await em.flush();
    await seedCountersLikeTheMigration();
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    const scope = new CompanyScopeService(orm.em);
    const sequences = new MasterSequenceService(orm.em);
    vendors = new VendorService(orm.em, scope, new ScopeService(), sequences);
    items = new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope), sequences);
  });

  it('starts above the legacy codes: I-00002 after I-00001, V-00001 beside BANKPICK-DEMO', async () => {
    const item = await asUser(() => items.create({ name: 'Pens' }));
    const vendor = await asUser(() => vendors.create({ name: 'Acme' }));
    expect(item.itemCode).toBe('I-00002');
    expect(vendor.vendorCode).toBe('V-00001');
  });

  it('issues consecutive codes', async () => {
    const a = await asUser(() => vendors.create({ name: 'One' }));
    const b = await asUser(() => vendors.create({ name: 'Two' }));
    const [na, nb] = [a, b].map((v) => Number(v.vendorCode.slice(2)));
    expect(nb).toBe(na + 1);
    expect(a.vendorCode).toMatch(/^V-\d{5}$/);
  });

  it('a supplied code is not part of the create contract', async () => {
    // The DTO has no such field: the type refuses it at compile time, and the HTTP whitelist
    // (forbidNonWhitelisted) refuses it at the boundary. What reaches the service is ignored.
    const v = await asUser(() => vendors.create({ name: 'Sneaky', vendorCode: 'MINE' } as never));
    expect(v.vendorCode).not.toBe('MINE');
    expect(v.vendorCode).toMatch(/^V-\d{5}$/);
  });

  it('never hands two concurrent creates the same code', async () => {
    const created = await Promise.all(
      Array.from({ length: 6 }, (_, k) => asUser(() => items.create({ name: `Bulk ${k}` }))),
    );
    const codes = created.map((i) => i.itemCode);
    expect(new Set(codes).size).toBe(6);
    const nums = codes.map((c) => Number(c.slice(2))).sort((x, y) => x - y);
    // Consecutive: the lock serialises the increments, so no number is skipped by a lost race.
    expect(nums[nums.length - 1] - nums[0]).toBe(5);
  });

  it('rolls the number back with a create that fails', async () => {
    const before = (await orm.em.fork().findOneOrFail(MasterSequence, { kind: 'VENDOR' })).currentNo;
    // A name longer than the column allows fails at INSERT, after the counter was incremented.
    await expect(asUser(() => vendors.create({ name: 'x'.repeat(300) }))).rejects.toThrow();
    const after = (await orm.em.fork().findOneOrFail(MasterSequence, { kind: 'VENDOR' })).currentNo;
    expect(after).toBe(before);
  });
});
