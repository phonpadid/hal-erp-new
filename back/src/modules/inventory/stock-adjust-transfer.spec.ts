import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { DocCategory, DocStatus, StockTxnType } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { Currency } from '../currency/currency.entities';
import { Document, DocumentLine, DocumentType, FormTemplate } from '../document/document.entities';
import { Item } from '../master-data/master-data.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { StockTxn } from './inventory.entities';
import { StockBalanceService } from './stock-balance.service';
import { StockLedgerService } from './stock-ledger.service';
import { StockMovementService, type StockDemand } from './stock-movement.service';
import { WarehouseService } from './warehouse.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('stock adjust + transfer (DB-backed)', () => {
  let orm: MikroORM;
  let balances: StockBalanceService;
  let ledger: StockLedgerService;
  let movements: StockMovementService;
  let warehouses: WarehouseService;
  const ids = { company: '', dept: '', user: '', type: '', tmpl: '', wf: '' };
  let itemA = '';
  let whA = '';
  let whB = '';
  let seq = 0;

  const asUser = <T>(fn: () => T): T =>
    RequestContext.run(
      { userId: ids.user, companyId: ids.company, departmentId: ids.dept, grants: [] },
      fn,
    );

  /** A document with one line per (item, qty). A negative qty is an adjustment decrease. */
  async function docWithLines(
    lines: Array<{ itemId: string; qty: string; unitPrice?: string; baseLineAmount?: string }>,
  ): Promise<Document> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `STK-${seq++}`,
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
    lines.forEach((l, i) =>
      em.create(DocumentLine, {
        document: doc,
        lineNo: i + 1,
        item: em.getReference(Item, l.itemId),
        description: `line ${i + 1}`,
        qty: l.qty,
        unitPrice: l.unitPrice ?? '0',
        lineAmount: l.baseLineAmount ?? '0',
        budgetBaseLineAmount: l.baseLineAmount,
      }),
    );
    await em.flush();
    return doc;
  }

  const row = async (warehouseId: string, itemId = itemA) => {
    const page = await asUser(() => balances.onHand({ itemId, warehouseId }));
    return page.items[0];
  };

  const seedStock = (warehouseId: string, qty: string, unitCost: string, itemId = itemA) =>
    asUser(() =>
      balances.transactional(async (tem) => {
        const locked = await balances.lockPairs(tem, [{ itemId, warehouseId }]);
        const balance = locked.get(`${itemId}:${warehouseId}`)!;
        const cost = balances.applyMovement(balance, StockTxnType.RECEIVE, qty, unitCost);
        ledger.record(tem, {
          itemId,
          warehouseId,
          txnType: StockTxnType.RECEIVE,
          qty,
          unitCost: cost,
        });
      }),
    );

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, {
      code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true,
    });
    const dept = em.create(Department, { company, deptCode: 'DA', name: 'DA', isActive: true });
    const user = em.create(AppUser, { username: 'store', email: 'store@x', status: 'ACTIVE' });
    const type = em.create(DocumentType, {
      company, code: 'ADJ', name: 'Adjust', category: DocCategory.ADMIN,
      requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: true,
      requiresPayee: false, requiresWarehouse: true, postAction: 'ADJUST_STOCK', isActive: true,
    });
    const tmpl = em.create(FormTemplate, { documentType: type, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    const item = em.create(Item, { itemCode: 'WID', name: 'Widget', isStockTracked: true, isActive: true });
    await em.flush();

    Object.assign(ids, {
      company: company.id, dept: dept.id, user: user.id,
      type: type.id, tmpl: tmpl.id, wf: wf.id,
    });
    itemA = item.id;

    const scope = new CompanyScopeService(orm.em);
    balances = new StockBalanceService(scope);
    ledger = new StockLedgerService(scope);
    movements = new StockMovementService(balances, ledger);
    warehouses = new WarehouseService(scope);

    whA = (await asUser(() => warehouses.create({ code: 'WHA', name: 'A' }))).id;
    whB = (await asUser(() => warehouses.create({ code: 'WHB', name: 'B' }))).id;
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  it('values an opening count into an empty warehouse from the line, not at zero', async () => {
    // Regression: the first adjustment into an empty warehouse has no average to inherit, so
    // reading the prevailing average gave a unit cost of 0 — stock existed physically with no
    // book value and, because a zero-value movement posts nothing, no GL entry at all.
    const wh = (await asUser(() => warehouses.create({ code: 'OPEN', name: 'Opening' }))).id;
    const doc = await docWithLines([
      { itemId: itemA, qty: '50', unitPrice: '250', baseLineAmount: '12500' },
    ]);
    await asUser(() => balances.transactional((tem) => movements.adjust(tem, doc, wh)));

    const balance = await row(wh);
    expect(balance.qtyOnHand).toBe('50.0000');
    expect(balance.avgCost).toBe('250.000000'); // 12500 / 50
    expect(balance.totalValue).toBe('12500.00');
  });

  it('increases stock and values the found units at the prevailing average', async () => {
    await seedStock(whA, '10', '100');
    const doc = await docWithLines([{ itemId: itemA, qty: '5' }]);
    await asUser(() => balances.transactional((tem) => movements.adjust(tem, doc, whA)));

    const balance = await row(whA);
    expect(balance.qtyOnHand).toBe('15.0000');
    // A found item is valued like its siblings, not at zero — which would dilute the average.
    expect(balance.avgCost).toBe('100.000000');
    expect(balance.totalValue).toBe('1500.00');
  });

  it('decreases stock and consumes at the prevailing average', async () => {
    const doc = await docWithLines([{ itemId: itemA, qty: '-3' }]);
    await asUser(() => balances.transactional((tem) => movements.adjust(tem, doc, whA)));

    const balance = await row(whA);
    expect(balance.qtyOnHand).toBe('12.0000');
    expect(balance.avgCost).toBe('100.000000');

    const em = orm.em.fork();
    const written = await em.findOneOrFail(
      StockTxn,
      { document: doc.id, txnType: StockTxnType.ADJUST_DECREASE },
      FILTER_OFF,
    );
    // Stored positive; direction is the type's job.
    expect(written.qty).toBe('3.0000');
    expect(written.unitCost).toBe('100.000000');
  });

  it('refuses a write-off larger than the balance', async () => {
    const doc = await docWithLines([{ itemId: itemA, qty: '-99' }]);
    await expect(
      asUser(() => balances.transactional((tem) => movements.adjust(tem, doc, whA))),
    ).rejects.toThrow(/would take 99/i);

    expect((await row(whA)).qtyOnHand).toBe('12.0000'); // untouched
  });

  it('handles increases and decreases in one document', async () => {
    const doc = await docWithLines([
      { itemId: itemA, qty: '4' },
      { itemId: itemA, qty: '-2' },
    ]);
    await asUser(() => balances.transactional((tem) => movements.adjust(tem, doc, whA)));
    expect((await row(whA)).qtyOnHand).toBe('14.0000'); // 12 + 4 - 2
  });

  it('moves quantity and cost between warehouses, blending at the destination', async () => {
    // Destination already holds 10 @ 130. Moving 4 @ 100 in gives 14 @ (1300+400)/14.
    await seedStock(whB, '10', '130');
    const doc = await docWithLines([{ itemId: itemA, qty: '4' }]);
    const demand: StockDemand = {
      documentId: doc.id,
      lines: [{ itemId: itemA, warehouseId: whA, qty: '4', lineNo: 1 }],
    };
    await asUser(() => balances.transactional((tem) => movements.transfer(tem, demand, whB)));

    const source = await row(whA);
    const dest = await row(whB);
    expect(source.qtyOnHand).toBe('10.0000');
    // The source's own average does not move — goods did not change value by leaving.
    expect(source.avgCost).toBe('100.000000');
    expect(dest.qtyOnHand).toBe('14.0000');
    expect(dest.avgCost).toBe('121.428571'); // (10*130 + 4*100) / 14
  });

  it('writes both legs of a transfer or neither', async () => {
    const em = orm.em.fork();
    const outs = await em.count(StockTxn, { txnType: StockTxnType.TRANSFER_OUT }, FILTER_OFF);
    const ins = await em.count(StockTxn, { txnType: StockTxnType.TRANSFER_IN }, FILTER_OFF);
    expect(outs).toBe(ins);
    expect(outs).toBeGreaterThan(0);
  });

  it('carries the source cost onto the TRANSFER_IN row', async () => {
    const em = orm.em.fork();
    const inRow = await em.findOneOrFail(
      StockTxn,
      { txnType: StockTxnType.TRANSFER_IN },
      { orderBy: { createdAt: 'DESC' }, ...FILTER_OFF },
    );
    expect(inRow.unitCost).toBe('100.000000');
  });

  it('does not deadlock when opposing transfers run concurrently', async () => {
    await seedStock(whA, '20', '100');
    await seedStock(whB, '20', '100');

    const docAB = await docWithLines([{ itemId: itemA, qty: '5' }]);
    const docBA = await docWithLines([{ itemId: itemA, qty: '5' }]);

    const move = (documentId: string, from: string, to: string) =>
      asUser(() =>
        balances.transactional((tem) =>
          movements.transfer(
            tem,
            { documentId, lines: [{ itemId: itemA, warehouseId: from, qty: '5', lineNo: 1 }] },
            to,
          ),
        ),
      );

    // Both lock the same two balance rows. Without a fixed (item, warehouse) lock order they
    // would take them in opposite sequences and wait on each other forever.
    const results = await Promise.allSettled([
      move(docAB.id, whA, whB),
      move(docBA.id, whB, whA),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    // 5 out and 5 in on each side nets to no change in total quantity: whA was 10 after the
    // earlier transfer and whB 14, plus the 20 each just seeded.
    const totalAfter = Number((await row(whA)).qtyOnHand) + Number((await row(whB)).qtyOnHand);
    expect(totalAfter).toBe(30 + 34);
  });
});
