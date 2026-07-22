import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { StockTxnType } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { DocStatus } from '../../common/enums';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Item } from '../master-data/master-data.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { WeightedAverageCosting } from './costing.strategy';
import { StockTxn } from './inventory.entities';
import { StockBalanceService } from './stock-balance.service';
import { StockLedgerService } from './stock-ledger.service';
import { StockMovementService, type StockDemand } from './stock-movement.service';
import { WarehouseService } from './warehouse.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * A minimal real Document. `stock_txn.document_id` is a UUID foreign key, so a movement must
 * point at a document that actually exists — which is the point: every ledger row is traceable
 * to the approval that authorised it.
 */
async function makeDoc(orm: MikroORM, companyId: string, docNo: string): Promise<string> {
  const em = orm.em.fork();
  const dept = await em.findOneOrFail(Department, { company: companyId, deptCode: 'PROC' }, FILTER_OFF);
  const prType = await em.findOneOrFail(DocumentType, { company: companyId, code: 'PR' }, FILTER_OFF);
  const mapping = await em.findOneOrFail(
    DeptDocType,
    { department: dept.id, documentType: prType.id },
    { populate: ['formTemplate', 'workflow'], ...FILTER_OFF },
  );
  const requester = await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF);
  const doc = em.create(Document, {
    docNo,
    company: em.getReference(Company, companyId),
    department: dept,
    documentType: prType,
    formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
    workflow: em.getReference(Workflow, mapping.workflow.id),
    createdBy: requester,
    status: DocStatus.SUBMITTED,
    currentStepNo: 1,
    exchangeRate: '1',
    createdAt: new Date(),
  });
  await em.flush();
  return doc.id;
}

/** Weighted average, with no DB in the way. */
describe('weighted-average costing', () => {
  const costing = new WeightedAverageCosting();

  it('blends an inbound receipt into the running average', () => {
    // 10 @ 100 then 10 @ 120 → 20 @ 110.
    const after = costing.costAfterInbound({ qtyOnHand: '10', avgCost: '100' }, '10', '120');
    expect(after).toBe('110.000000');
  });

  it('sets rather than averages when the balance is empty', () => {
    // Averaging against nothing is undefined, not zero — this is every item's first receipt.
    expect(costing.costAfterInbound({ qtyOnHand: '0', avgCost: '0' }, '10', '75')).toBe('75.000000');
  });

  it('consumes at the prevailing average and does not move it', () => {
    expect(costing.costToConsume({ qtyOnHand: '20', avgCost: '110' })).toBe('110.000000');
  });

  it('keeps six decimals so many small receipts do not accumulate error', () => {
    // 3 @ 10 then 1 @ 11 → 41/4 = 10.25; a 2-dp cost would already be rounding here.
    const after = costing.costAfterInbound({ qtyOnHand: '3', avgCost: '10' }, '1', '11');
    expect(after).toBe('10.250000');
  });
});

describe.skipIf(!hasDb)('stock reserve → issue → release (DB-backed)', () => {
  let orm: MikroORM;
  let warehouses: WarehouseService;
  let balances: StockBalanceService;
  let ledger: StockLedgerService;
  let movements: StockMovementService;
  let companyA = '';
  let itemId = '';
  let whId = '';
  const docs: Record<string, string> = {};

  const asCompanyA = <T>(fn: () => T): T =>
    RequestContext.run({ userId: undefined, companyId: companyA, grants: [] }, fn);

  /** A demand built by hand, so these tests exercise movement logic without a whole submit. */
  const demand = (documentId: string, qty: string, warehouseId = whId): StockDemand => ({
    documentId,
    lines: [{ itemId, warehouseId, qty, lineNo: 1 }],
  });

  const onHand = async () => {
    const page = await asCompanyA(() => balances.onHand({ itemId, warehouseId: whId }));
    return page.items[0];
  };

  const receive = (qty: string, unitCost: string) =>
    asCompanyA(() =>
      balances.transactional(async (tem) => {
        const locked = await balances.lockPairs(tem, [{ itemId, warehouseId: whId }]);
        const balance = locked.get(`${itemId}:${whId}`)!;
        const cost = balances.applyMovement(balance, StockTxnType.RECEIVE, qty, unitCost);
        ledger.record(tem, {
          itemId,
          warehouseId: whId,
          txnType: StockTxnType.RECEIVE,
          qty,
          unitCost: cost,
        });
      }),
    );

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    const scope = new CompanyScopeService(orm.em);
    warehouses = new WarehouseService(scope);
    balances = new StockBalanceService(scope);
    ledger = new StockLedgerService(scope);
    movements = new StockMovementService(balances, ledger);

    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    const item = em.create(Item, {
      itemCode: 'NUT',
      name: 'Nut M8',
      isStockTracked: true,
      isActive: true,
    });
    await em.flush();
    itemId = item.id;

    whId = (await asCompanyA(() => warehouses.create({ code: 'MOVE', name: 'Movement store' }))).id;
    for (const key of ['doc-1', 'doc-2', 'doc-3', 'doc-4']) {
      docs[key] = await makeDoc(orm, companyA, `STK-${key}`);
    }
    await receive('10', '100');
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  it('reserves without moving on-hand', async () => {
    await asCompanyA(() => balances.transactional((tem) => movements.reserve(tem, demand(docs['doc-1'], '4'))));
    const row = await onHand();
    expect(row.qtyOnHand).toBe('10.0000');
    expect(row.qtyReserved).toBe('4.0000');
    expect(row.qtyAvailable).toBe('6.0000');
  });

  it('blocks a reservation that exceeds available and writes nothing', async () => {
    // 10 on hand, 4 already held → 6 available. Asking for 7 must fail outright.
    await expect(
      asCompanyA(() => balances.transactional((tem) => movements.reserve(tem, demand(docs['doc-2'], '7')))),
    ).rejects.toThrow(/insufficient stock/i);

    const row = await onHand();
    expect(row.qtyReserved).toBe('4.0000'); // unchanged — no partial reservation

    const em = orm.em.fork();
    expect(await em.count(StockTxn, { document: docs['doc-2'] }, FILTER_OFF)).toBe(0);
  });

  it('checks two lines of the same item against their combined quantity', async () => {
    // 6 available. Two lines of 4 pass individually but must be rejected as 8.
    const twoLines: StockDemand = {
      documentId: docs['doc-3'],
      lines: [
        { itemId, warehouseId: whId, qty: '4', lineNo: 1 },
        { itemId, warehouseId: whId, qty: '4', lineNo: 2 },
      ],
    };
    await expect(
      asCompanyA(() => balances.transactional((tem) => movements.reserve(tem, twoLines))),
    ).rejects.toThrow(/insufficient stock/i);
  });

  it('issues at the prevailing average and discharges the hold', async () => {
    await asCompanyA(() => balances.transactional((tem) => movements.issue(tem, demand(docs['doc-1'], '4'))));

    const row = await onHand();
    // 10 - 4 = 6 on hand; the reservation is discharged by the issue, not left holding.
    expect(row.qtyOnHand).toBe('6.0000');
    expect(row.qtyReserved).toBe('0.0000');
    expect(row.avgCost).toBe('100.000000'); // issuing never moves the unit cost
    expect(row.totalValue).toBe('600.00');

    const em = orm.em.fork();
    const issued = await em.findOneOrFail(
      StockTxn,
      { document: docs['doc-1'], txnType: StockTxnType.ISSUE },
      FILTER_OFF,
    );
    expect(issued.unitCost).toBe('100.000000');
  });

  it('re-averages on a second receipt at a different cost', async () => {
    // 6 @ 100 + 6 @ 120 → 12 @ 110.
    await receive('6', '120');
    const row = await onHand();
    expect(row.qtyOnHand).toBe('12.0000');
    expect(row.avgCost).toBe('110.000000');
    expect(row.totalValue).toBe('1320.00');
  });

  it('releases an outstanding hold on reject', async () => {
    await asCompanyA(() => balances.transactional((tem) => movements.reserve(tem, demand(docs['doc-4'], '5'))));
    expect((await onHand()).qtyReserved).toBe('5.0000');

    await asCompanyA(() => balances.transactional((tem) => movements.release(tem, docs['doc-4'])));

    const row = await onHand();
    expect(row.qtyReserved).toBe('0.0000');
    expect(row.qtyOnHand).toBe('12.0000'); // a release returns availability, not stock
  });

  it('is idempotent when released twice', async () => {
    await asCompanyA(() => balances.transactional((tem) => movements.release(tem, docs['doc-4'])));

    const em = orm.em.fork();
    const releases = await em.count(
      StockTxn,
      { document: docs['doc-4'], txnType: StockTxnType.RELEASE },
      FILTER_OFF,
    );
    expect(releases).toBe(1); // not two
    expect((await onHand()).qtyReserved).toBe('0.0000');
  });

  it('writes nothing when releasing a document whose hold was already issued', async () => {
    // doc-1 reserved then issued — its outstanding hold is zero, so there is nothing to give back.
    await asCompanyA(() => balances.transactional((tem) => movements.release(tem, docs['doc-1'])));

    const em = orm.em.fork();
    const releases = await em.count(
      StockTxn,
      { document: docs['doc-1'], txnType: StockTxnType.RELEASE },
      FILTER_OFF,
    );
    expect(releases).toBe(0);
  });

  it('never writes a budget_txn for a stock movement', async () => {
    // Budget is committed by the purchase document and actualized at payment. A stock movement
    // that also cut budget would charge the same purchase twice (invariant 3).
    const em = orm.em.fork();
    const budgetRows = await em.execute(
      `select count(*)::int as n from budget_txn where document_id in (?, ?)`,
      [docs['doc-1'], docs['doc-4']],
    );
    expect(budgetRows[0].n).toBe(0);
  });
});

describe.skipIf(!hasDb)('stock concurrency (DB-backed)', () => {
  let orm: MikroORM;
  let balances: StockBalanceService;
  let ledger: StockLedgerService;
  let movements: StockMovementService;
  let companyA = '';
  let itemId = '';
  let whId = '';
  const docs: Record<string, string> = {};

  const asCompanyA = <T>(fn: () => T): T =>
    RequestContext.run({ userId: undefined, companyId: companyA, grants: [] }, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    const scope = new CompanyScopeService(orm.em);
    balances = new StockBalanceService(scope);
    ledger = new StockLedgerService(scope);
    movements = new StockMovementService(balances, ledger);

    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    const item = em.create(Item, { itemCode: 'RACE', name: 'Race item', isStockTracked: true, isActive: true });
    await em.flush();
    itemId = item.id;
    whId = (await asCompanyA(() => new WarehouseService(scope).create({ code: 'RACE', name: 'Race' }))).id;
    for (const key of ['race-a', 'race-b']) docs[key] = await makeDoc(orm, companyA, `RACE-${key}`);

    await asCompanyA(() =>
      balances.transactional(async (tem) => {
        const locked = await balances.lockPairs(tem, [{ itemId, warehouseId: whId }]);
        const balance = locked.get(`${itemId}:${whId}`)!;
        const cost = balances.applyMovement(balance, StockTxnType.RECEIVE, '10', '100');
        ledger.record(tem, { itemId, warehouseId: whId, txnType: StockTxnType.RECEIVE, qty: '10', unitCost: cost });
      }),
    );
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  it('lets exactly one of two concurrent reservations for 6 succeed against 10 available', async () => {
    const reserve = (documentId: string) =>
      asCompanyA(() =>
        balances.transactional((tem) =>
          movements.reserve(tem, {
            documentId,
            lines: [{ itemId, warehouseId: whId, qty: '6', lineNo: 1 }],
          }),
        ),
      );

    const results = await Promise.allSettled([reserve(docs['race-a']), reserve(docs['race-b'])]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    // Without SELECT FOR UPDATE both would read "10 available" and both would commit, reserving
    // 12 against 10 and driving availability negative.
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const page = await asCompanyA(() => balances.onHand({ itemId, warehouseId: whId }));
    expect(page.items[0].qtyReserved).toBe('6.0000');
    expect(page.items[0].qtyAvailable).toBe('4.0000'); // never negative
  });

  it('re-averages correctly when two receipts commit concurrently', async () => {
    const scope = new CompanyScopeService(orm.em);
    const isolated = new StockBalanceService(scope);
    const isolatedLedger = new StockLedgerService(scope);

    const receive = (qty: string, unitCost: string) =>
      asCompanyA(() =>
        isolated.transactional(async (tem) => {
          const locked = await isolated.lockPairs(tem, [{ itemId, warehouseId: whId }]);
          const balance = locked.get(`${itemId}:${whId}`)!;
          const cost = isolated.applyMovement(balance, StockTxnType.RECEIVE, qty, unitCost);
          isolatedLedger.record(tem, {
            itemId,
            warehouseId: whId,
            txnType: StockTxnType.RECEIVE,
            qty,
            unitCost: cost,
          });
        }),
      );

    // Starting at 10 @ 100. Adding 10 @ 100 and 10 @ 130 in either order gives 30 @ 110.
    await Promise.all([receive('10', '100'), receive('10', '130')]);

    const page = await asCompanyA(() => isolated.onHand({ itemId, warehouseId: whId }));
    expect(page.items[0].qtyOnHand).toBe('30.0000');
    // Order-independent: (10*100 + 10*100 + 10*130) / 30 = 110.
    expect(page.items[0].avgCost).toBe('110.000000');
  });
});
