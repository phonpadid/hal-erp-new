import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { DocCategory, DocStatus, StockTxnType } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { Currency } from '../currency/currency.entities';
import { StockTxn } from '../inventory/inventory.entities';
import { StockBalanceService } from '../inventory/stock-balance.service';
import { StockLedgerService } from '../inventory/stock-ledger.service';
import { WarehouseService } from '../inventory/warehouse.service';
import { Item } from '../master-data/master-data.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { Document, DocumentLine, DocumentType, FormTemplate } from './document.entities';
import { ReceivingService } from './receiving.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('goods receipt puts stock away (DB-backed)', () => {
  let orm: MikroORM;
  let receiving: ReceivingService;
  let balances: StockBalanceService;
  let warehouses: WarehouseService;
  const ids = { company: '', otherCompany: '', dept: '', user: '', type: '', tmpl: '', wf: '' };
  let trackedItem = '';
  let untrackedItem = '';
  let whId = '';
  let otherWhId = '';
  let seq = 0;

  const asUser = <T>(fn: () => Promise<T>): Promise<T> =>
    RequestContext.run(
      { userId: ids.user, companyId: ids.company, departmentId: ids.dept, grants: [] },
      fn,
    );
  const asOtherCompany = <T>(fn: () => Promise<T>): Promise<T> =>
    RequestContext.run({ userId: ids.user, companyId: ids.otherCompany, grants: [] }, fn);

  /**
   * A PO line whose base amount implies the given unit cost. `budgetBaseLineAmount` is the
   * base-currency figure stamped at the locked submit-time rate — the receipt reads it rather
   * than resolving an FX rate of its own.
   */
  async function poLine(opts: {
    itemId?: string;
    qty: string;
    baseLineAmount: string;
  }): Promise<{ docId: string; lineId: string }> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `PO-STK-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.type),
      formTemplate: em.getReference(FormTemplate, ids.tmpl),
      workflow: em.getReference(Workflow, ids.wf),
      createdBy: em.getReference(AppUser, ids.user),
      exchangeRate: '1',
      status: DocStatus.APPROVED,
      createdAt: new Date(),
    });
    const line = em.create(DocumentLine, {
      document: doc,
      lineNo: 1,
      item: opts.itemId ? em.getReference(Item, opts.itemId) : undefined,
      description: 'Widget',
      qty: opts.qty,
      unitPrice: '0',
      lineAmount: opts.baseLineAmount,
      budgetBaseLineAmount: opts.baseLineAmount,
    });
    await em.flush();
    return { docId: doc.id, lineId: line.id };
  }

  const onHand = async (itemId: string, warehouseId = whId) => {
    const page = await asUser(() => balances.onHand({ itemId, warehouseId }));
    return page.items[0];
  };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, {
      code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true,
    });
    const other = em.create(Company, {
      code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true,
    });
    const dept = em.create(Department, { company, deptCode: 'DA', name: 'DA', isActive: true });
    const user = em.create(AppUser, { username: 'buyer', email: 'buyer@x', status: 'ACTIVE' });
    const type = em.create(DocumentType, {
      company, code: 'PO', name: 'PO', category: DocCategory.PROCUREMENT,
      requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false,
      requiresPayee: false, requiresWarehouse: false, isActive: true,
    });
    const tmpl = em.create(FormTemplate, { documentType: type, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    const tracked = em.create(Item, { itemCode: 'TRK', name: 'Tracked', isStockTracked: true, isActive: true });
    const untracked = em.create(Item, { itemCode: 'SVC', name: 'A service', isStockTracked: false, isActive: true });
    await em.flush();

    Object.assign(ids, {
      company: company.id, otherCompany: other.id, dept: dept.id, user: user.id,
      type: type.id, tmpl: tmpl.id, wf: wf.id,
    });
    trackedItem = tracked.id;
    untrackedItem = untracked.id;

    const scope = new CompanyScopeService(orm.em);
    balances = new StockBalanceService(scope);
    warehouses = new WarehouseService(scope);
    receiving = new ReceivingService(scope, balances, new StockLedgerService(scope), warehouses);

    whId = (await asUser(() => warehouses.create({ code: 'MAIN', name: 'Main' }))).id;
    otherWhId = (await asOtherCompany(() => warehouses.create({ code: 'BWH', name: 'B WH' }))).id;
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  it('receives a tracked item into the warehouse at the line base cost', async () => {
    // 10 ordered at a base amount of 1200 → unit cost 120.
    const { docId, lineId } = await poLine({ itemId: trackedItem, qty: '10', baseLineAmount: '1200' });
    const out = await asUser(() =>
      receiving.receive(docId, { warehouseId: whId, lines: [{ lineId, qty: '10' }] }),
    );

    expect(out[0].receivedQty).toBe('10');
    expect(out[0].lineStatus).toBe('RECEIVED');
    expect(out[0].stockedQty).toBe('10');
    expect(out[0].unitCost).toBe('120');

    const row = await onHand(trackedItem);
    expect(row.qtyOnHand).toBe('10.0000');
    expect(row.avgCost).toBe('120.000000');
    expect(row.totalValue).toBe('1200.00');
  });

  it('re-averages when a second receipt arrives at a different cost', async () => {
    // 10 @ 120 already on hand; +10 @ 100 → 20 @ 110.
    const { docId, lineId } = await poLine({ itemId: trackedItem, qty: '10', baseLineAmount: '1000' });
    await asUser(() => receiving.receive(docId, { warehouseId: whId, lines: [{ lineId, qty: '10' }] }));

    const row = await onHand(trackedItem);
    expect(row.qtyOnHand).toBe('20.0000');
    expect(row.avgCost).toBe('110.000000');
  });

  it('records a partial receipt as partial stock', async () => {
    const { docId, lineId } = await poLine({ itemId: trackedItem, qty: '10', baseLineAmount: '1100' });
    const out = await asUser(() =>
      receiving.receive(docId, { warehouseId: whId, lines: [{ lineId, qty: '4' }] }),
    );

    expect(out[0].lineStatus).toBe('PARTIAL');
    expect(out[0].stockedQty).toBe('4'); // only what actually arrived
    expect((await onHand(trackedItem)).qtyOnHand).toBe('24.0000');
  });

  it('leaves stock alone for an untracked item', async () => {
    const { docId, lineId } = await poLine({ itemId: untrackedItem, qty: '5', baseLineAmount: '500' });
    const out = await asUser(() =>
      receiving.receive(docId, { warehouseId: whId, lines: [{ lineId, qty: '5' }] }),
    );

    // received_qty still advances — matching reads it whether or not the item is stocked.
    expect(out[0].receivedQty).toBe('5');
    expect(out[0].stockedQty).toBeUndefined();

    const em = orm.em.fork();
    expect(await em.count(StockTxn, { item: untrackedItem }, FILTER_OFF)).toBe(0);
  });

  it('leaves stock alone for an item-less line', async () => {
    const { docId, lineId } = await poLine({ qty: '3', baseLineAmount: '300' });
    const out = await asUser(() =>
      receiving.receive(docId, { warehouseId: whId, lines: [{ lineId, qty: '3' }] }),
    );
    expect(out[0].receivedQty).toBe('3');
    expect(out[0].stockedQty).toBeUndefined();
  });

  it('receives without a warehouse exactly as it did before stock existed', async () => {
    const { docId, lineId } = await poLine({ itemId: trackedItem, qty: '6', baseLineAmount: '600' });
    const before = (await onHand(trackedItem)).qtyOnHand;

    const out = await asUser(() => receiving.receive(docId, { lines: [{ lineId, qty: '6' }] }));

    expect(out[0].receivedQty).toBe('6');
    expect(out[0].stockedQty).toBeUndefined();
    expect((await onHand(trackedItem)).qtyOnHand).toBe(before);
  });

  it('rejects a warehouse belonging to another company', async () => {
    const { docId, lineId } = await poLine({ itemId: trackedItem, qty: '5', baseLineAmount: '500' });
    await expect(
      asUser(() => receiving.receive(docId, { warehouseId: otherWhId, lines: [{ lineId, qty: '5' }] })),
    ).rejects.toThrow(/not found in the active company/i);

    // received_qty must be untouched — the rejection happens before any write.
    const em = orm.em.fork();
    const line = await em.findOneOrFail(DocumentLine, { id: lineId }, FILTER_OFF);
    expect(line.receivedQty).toBe('0.0000');
  });

  it('rolls back received_qty when the stock write fails', async () => {
    const { docId, lineId } = await poLine({ itemId: trackedItem, qty: '5', baseLineAmount: '500' });

    // A ledger that throws mid-transaction stands in for any stock-side failure.
    const scope = new CompanyScopeService(orm.em);
    const exploding = new StockLedgerService(scope);
    exploding.record = () => {
      throw new Error('stock write failed');
    };
    const brittle = new ReceivingService(scope, balances, exploding, warehouses);

    await expect(
      asUser(() => brittle.receive(docId, { warehouseId: whId, lines: [{ lineId, qty: '5' }] })),
    ).rejects.toThrow(/stock write failed/i);

    // Both happen in one transaction, so matching cannot believe goods arrived that the
    // warehouse never saw.
    const em = orm.em.fork();
    const line = await em.findOneOrFail(DocumentLine, { id: lineId }, FILTER_OFF);
    expect(line.receivedQty).toBe('0.0000');
  });

  it('still rejects over-receipt with a warehouse named', async () => {
    const { docId, lineId } = await poLine({ itemId: trackedItem, qty: '5', baseLineAmount: '500' });
    await expect(
      asUser(() => receiving.receive(docId, { warehouseId: whId, lines: [{ lineId, qty: '6' }] })),
    ).rejects.toThrow(/over-receipt/i);
  });

  it('writes no budget_txn', async () => {
    // Budget is committed by the purchase document and actualized at payment. A receipt that also
    // cut budget would charge the same purchase twice (invariant 3).
    const em = orm.em.fork();
    const rows = await em.execute(`select count(*)::int as n from budget_txn`);
    expect(rows[0].n).toBe(0);
  });

  it('accumulates concurrent receipts to the same average as a serial run', async () => {
    const { docId: d1, lineId: l1 } = await poLine({ itemId: trackedItem, qty: '10', baseLineAmount: '1000' });
    const { docId: d2, lineId: l2 } = await poLine({ itemId: trackedItem, qty: '10', baseLineAmount: '1300' });

    const before = await onHand(trackedItem);
    const beforeQty = before.qtyOnHand;
    const beforeValue = before.totalValue;

    await Promise.all([
      asUser(() => receiving.receive(d1, { warehouseId: whId, lines: [{ lineId: l1, qty: '10' }] })),
      asUser(() => receiving.receive(d2, { warehouseId: whId, lines: [{ lineId: l2, qty: '10' }] })),
    ]);

    const after = await onHand(trackedItem);
    // Both receipts land, and the resulting average is the value-weighted one — which is only
    // true if each re-average ran under the row lock rather than from a stale read.
    expect(after.qtyOnHand).toBe(String(Number(beforeQty) + 20) + '.0000');
    const expectedValue = (Number(beforeValue) + 1000 + 1300).toFixed(2);
    expect(after.totalValue).toBe(expectedValue);
  });
});
