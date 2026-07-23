import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StockTxnType } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Item } from '../master-data/master-data.entities';
import { Company } from '../multi-company/multi-company.entities';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { StockBalance, StockTxn, Warehouse } from './inventory.entities';
import { aggregateByPair, orderPairs, StockBalanceService } from './stock-balance.service';
import { onHandDelta, reservedDelta, StockLedgerService } from './stock-ledger.service';
import { WarehouseService } from './warehouse.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Pure ledger arithmetic — no DB. These encode invariant 3 for stock: the balance is a function
 * of the ledger, and ISSUE discharges a reservation rather than charging a second time.
 */
describe('stock ledger arithmetic', () => {
  it('derives on-hand from inbound and outbound types only', () => {
    expect(onHandDelta(StockTxnType.RECEIVE, '10')).toBe('10');
    expect(onHandDelta(StockTxnType.TRANSFER_IN, '10')).toBe('10');
    expect(onHandDelta(StockTxnType.ADJUST_INCREASE, '10')).toBe('10');
    expect(onHandDelta(StockTxnType.ISSUE, '10')).toBe('-10');
    expect(onHandDelta(StockTxnType.TRANSFER_OUT, '10')).toBe('-10');
    expect(onHandDelta(StockTxnType.ADJUST_DECREASE, '10')).toBe('-10');
  });

  it('leaves on-hand untouched for RESERVE and RELEASE', () => {
    // They move what is AVAILABLE, not what is in the building.
    expect(onHandDelta(StockTxnType.RESERVE, '4')).toBe('0');
    expect(onHandDelta(StockTxnType.RELEASE, '4')).toBe('0');
  });

  it('discharges the reservation on ISSUE rather than double-counting', () => {
    expect(reservedDelta(StockTxnType.RESERVE, '4')).toBe('4');
    expect(reservedDelta(StockTxnType.RELEASE, '4')).toBe('-4');
    // The conversion: issuing both removes stock AND frees the hold it was under.
    expect(reservedDelta(StockTxnType.ISSUE, '4')).toBe('-4');
    expect(reservedDelta(StockTxnType.RECEIVE, '4')).toBe('0');
  });

  it('orders lock acquisition deterministically', () => {
    const a = { itemId: 'aaa', warehouseId: 'zzz' };
    const b = { itemId: 'bbb', warehouseId: 'aaa' };
    // Same set, opposite input order — a transfer A→B and B→A must lock identically or deadlock.
    expect(orderPairs([b, a])).toEqual([a, b]);
    expect(orderPairs([a, b])).toEqual([a, b]);
  });

  it('sums duplicate pairs before they are checked', () => {
    // Two lines of 6 for one item must be checked as 12, not twice as 6.
    const summed = aggregateByPair([
      { itemId: 'i1', warehouseId: 'w1', qty: '6' },
      { itemId: 'i1', warehouseId: 'w1', qty: '6' },
      { itemId: 'i2', warehouseId: 'w1', qty: '3' },
    ]);
    expect(summed).toHaveLength(2);
    expect(summed.find((p) => p.itemId === 'i1')!.qty).toBe('12');
  });
});

describe.skipIf(!hasDb)('inventory foundation: warehouses, ledger, derived balance (DB-backed)', () => {
  let orm: MikroORM;
  let warehouses: WarehouseService;
  let balances: StockBalanceService;
  let ledger: StockLedgerService;
  let companyA = '';
  let companyB = '';
  let itemId = '';

  const asCompanyA = <T>(fn: () => T): T =>
    RequestContext.run({ userId: undefined, companyId: companyA, grants: [] }, fn);
  const asCompanyB = <T>(fn: () => T): T =>
    RequestContext.run({ userId: undefined, companyId: companyB, grants: [] }, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    const scope = new CompanyScopeService(orm.em);
    warehouses = new WarehouseService(scope);
    balances = new StockBalanceService(scope);
    ledger = new StockLedgerService(scope);

    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;

    const thb = await em.findOneOrFail(Currency, { code: 'THB' }, FILTER_OFF);
    const compB = em.create(Company, {
      code: 'INVB',
      nameTh: 'บริษัทบี',
      nameEn: 'B Co',
      taxId: '2',
      branchCode: '00000',
      baseCurrency: thb,
      isActive: true,
      createdAt: new Date(),
    });
    await em.flush();
    companyB = compB.id;

    const item = em.create(Item, {
      itemCode: 'BOLT',
      name: 'Bolt M8',
      defaultUnit: 'pcs',
      isStockTracked: true,
      isActive: true,
    });
    await em.flush();
    itemId = item.id;
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  it('creates a warehouse in the active company', async () => {
    const wh = await asCompanyA(() => warehouses.create({ code: 'SPEC1', name: 'Spec store' }));
    expect(wh.code).toBe('SPEC1');
    expect(wh.isActive).toBe(true);
  });

  it('rejects a duplicate code within the same company', async () => {
    await expect(asCompanyA(() => warehouses.create({ code: 'SPEC1', name: 'Again' }))).rejects.toThrow(
      /already exists/i,
    );
  });

  it('lets a second company reuse the same warehouse code', async () => {
    // Uniqueness is per company: two companies may each run a warehouse with the same code.
    const wh = await asCompanyB(() => warehouses.create({ code: 'SPEC1', name: 'B main' }));
    expect(wh.code).toBe('SPEC1');
  });

  it('does not resolve another company’s warehouse by id', async () => {
    const bWarehouse = await asCompanyB(() => warehouses.create({ code: 'BONLY', name: 'B only' }));
    await expect(asCompanyA(() => warehouses.get(bWarehouse.id))).rejects.toThrow(/not found/i);
  });

  it('deactivates instead of deleting, and stops offering the warehouse', async () => {
    const wh = await asCompanyA(() => warehouses.create({ code: 'OLD', name: 'Old store' }));
    await asCompanyA(() => warehouses.deactivate(wh.id));

    const em = orm.em.fork();
    const stillThere = await em.findOne(Warehouse, { id: wh.id }, FILTER_OFF);
    expect(stillThere).not.toBeNull();
    expect(stillThere!.isActive).toBe(false);

    // Inactive is not selectable for a movement, even though the row survives for history.
    await expect(asCompanyA(() => warehouses.requireActive(wh.id))).rejects.toThrow(/inactive/i);

    const active = await asCompanyA(() => warehouses.list({}, false));
    expect(active.items.some((w) => w.id === wh.id)).toBe(false);
  });

  it('creates a balance row on first movement and derives it back from the ledger', async () => {
    const wh = await asCompanyA(() => warehouses.create({ code: 'DERIVE', name: 'Derive test' }));

    await asCompanyA(() =>
      balances.transactional(async (tem) => {
        const locked = await balances.lockPairs(tem, [{ itemId, warehouseId: wh.id }]);
        const balance = locked.get(`${itemId}:${wh.id}`)!;

        // A history with every kind of movement: receive, reserve, issue, adjust.
        const moves: Array<[StockTxnType, string]> = [
          [StockTxnType.RECEIVE, '10'],
          [StockTxnType.RECEIVE, '10'],
          [StockTxnType.RESERVE, '4'],
          [StockTxnType.ISSUE, '4'],
          [StockTxnType.ADJUST_DECREASE, '1'],
        ];
        for (const [txnType, qty] of moves) {
          ledger.record(tem, { itemId, warehouseId: wh.id, txnType, qty, unitCost: '100' });
          balances.applyQuantity(balance, txnType, qty);
        }
      }),
    );

    const em = orm.em.fork();
    const rows = await em.find(StockTxn, { item: itemId, warehouse: wh.id }, FILTER_OFF);
    expect(rows).toHaveLength(5);

    // 20 received, 4 issued, 1 written off = 15 on hand; the reservation was discharged by the issue.
    const derived = await asCompanyA(() => balances.deriveFromLedger(itemId, wh.id));
    expect(derived.qtyOnHand).toBe('15.0000');
    expect(derived.qtyReserved).toBe('0.0000');

    // The stored projection must equal the replay exactly (invariant 3).
    const onHand = await asCompanyA(() => balances.onHand({ itemId, warehouseId: wh.id }));
    expect(onHand.items).toHaveLength(1);
    expect(onHand.items[0].qtyOnHand).toBe(derived.qtyOnHand);
    expect(onHand.items[0].qtyReserved).toBe(derived.qtyReserved);
    expect(onHand.items[0].qtyAvailable).toBe('15.0000');
  });

  it('reports available as on-hand minus reserved', async () => {
    const wh = await asCompanyA(() => warehouses.create({ code: 'AVAIL', name: 'Availability' }));

    await asCompanyA(() =>
      balances.transactional(async (tem) => {
        const locked = await balances.lockPairs(tem, [{ itemId, warehouseId: wh.id }]);
        const balance = locked.get(`${itemId}:${wh.id}`)!;
        ledger.record(tem, { itemId, warehouseId: wh.id, txnType: StockTxnType.RECEIVE, qty: '10', unitCost: '100' });
        balances.applyQuantity(balance, StockTxnType.RECEIVE, '10');
        ledger.record(tem, { itemId, warehouseId: wh.id, txnType: StockTxnType.RESERVE, qty: '8' });
        balances.applyQuantity(balance, StockTxnType.RESERVE, '8');
      }),
    );

    const onHand = await asCompanyA(() => balances.onHand({ itemId, warehouseId: wh.id }));
    // "10 on hand of which 8 are spoken for" — availability is the number that gates an issue.
    expect(onHand.items[0].qtyOnHand).toBe('10.0000');
    expect(onHand.items[0].qtyReserved).toBe('8.0000');
    expect(onHand.items[0].qtyAvailable).toBe('2.0000');
  });

  it('refuses to update a stock_txn row (append-only, invariant 2)', async () => {
    const wh = await asCompanyA(() => warehouses.create({ code: 'APPEND', name: 'Append only' }));
    await asCompanyA(() =>
      balances.transactional(async (tem) => {
        const locked = await balances.lockPairs(tem, [{ itemId, warehouseId: wh.id }]);
        // The balance is updated alongside the ledger row even though this test only cares about
        // the append-only guard: leaving it out would make the projection disagree with the
        // ledger, and the rebuild check below would (rightly) fail on this fixture.
        const cost = balances.applyMovement(locked.get(`${itemId}:${wh.id}`)!, StockTxnType.RECEIVE, '5', '100');
        ledger.record(tem, { itemId, warehouseId: wh.id, txnType: StockTxnType.RECEIVE, qty: '5', unitCost: cost });
      }),
    );

    const em = orm.em.fork();
    const txn = await em.findOneOrFail(StockTxn, { warehouse: wh.id }, FILTER_OFF);
    txn.qty = '999';
    // The LedgerGuardSubscriber blocks it: a correction is a new row, never a rewrite.
    await expect(em.flush()).rejects.toThrow(/append-only/i);
  });

  it('keeps another company’s stock out of the read', async () => {
    const whB = await asCompanyB(() => warehouses.create({ code: 'BSTOCK', name: 'B stock' }));
    await asCompanyB(() =>
      balances.transactional(async (tem) => {
        const locked = await balances.lockPairs(tem, [{ itemId, warehouseId: whB.id }]);
        ledger.record(tem, { itemId, warehouseId: whB.id, txnType: StockTxnType.RECEIVE, qty: '77', unitCost: '100' });
        balances.applyQuantity(locked.get(`${itemId}:${whB.id}`)!, StockTxnType.RECEIVE, '77');
      }),
    );

    const fromA = await asCompanyA(() => balances.onHand({ itemId }));
    expect(fromA.items.some((r) => r.warehouseId === whB.id)).toBe(false);

    const historyFromA = await asCompanyA(() => ledger.history({ itemId }));
    expect(historyFromA.items.some((r) => r.warehouseId === whB.id)).toBe(false);
  });

  it('reproduces every stored balance from the ledger alone', async () => {
    // The projection is only trustworthy if it is reconstructible (invariant 3). This walks every
    // balance this spec produced — receipts, issues, reservations, adjustments, two companies —
    // and replays each one, so drift anywhere in the suite fails here rather than in production.
    const em = orm.em.fork();
    const all = await em.find(StockBalance, {}, { populate: ['item', 'warehouse'], ...FILTER_OFF });
    expect(all.length).toBeGreaterThan(0);

    for (const stored of all) {
      const derived = await RequestContext.run(
        { userId: undefined, companyId: stored.company.id, grants: [] },
        () => balances.deriveFromLedger(stored.item.id, stored.warehouse.id),
      );
      expect(
        derived.qtyOnHand,
        `on-hand drift for item ${stored.item.id} in warehouse ${stored.warehouse.id}`,
      ).toBe(stored.qtyOnHand);
      expect(
        derived.qtyReserved,
        `reserved drift for item ${stored.item.id} in warehouse ${stored.warehouse.id}`,
      ).toBe(stored.qtyReserved);
    }
  });

  it('rebuilds a drifted balance from its ledger', async () => {
    const wh = await asCompanyA(() => warehouses.create({ code: 'REPAIR', name: 'Repair path' }));
    await asCompanyA(() =>
      balances.transactional(async (tem) => {
        const locked = await balances.lockPairs(tem, [{ itemId, warehouseId: wh.id }]);
        ledger.record(tem, { itemId, warehouseId: wh.id, txnType: StockTxnType.RECEIVE, qty: '12', unitCost: '100' });
        balances.applyQuantity(locked.get(`${itemId}:${wh.id}`)!, StockTxnType.RECEIVE, '12');
      }),
    );

    // Simulate drift: the projection says something the ledger does not.
    const em = orm.em.fork();
    await em.nativeUpdate(
      'stock_balance',
      { item_id: itemId, warehouse_id: wh.id },
      { qty_on_hand: '999' },
    );

    const repaired = await asCompanyA(() => balances.recompute(itemId, wh.id));
    expect(repaired.qtyOnHand).toBe('12.0000');
  });
});
