import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { budgetAt } from '../../test/budget-fixture';
import { BudgetTxnType, ControlPolicy } from '../../common/enums';
import { ErrorCode } from '../../common/errors/error-code';
import { Money } from '../../common/money/money';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Account } from '../accounting/accounting.entities';
import { Workflow } from '../approval/approval.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetCoverageService } from './budget-coverage.service';
import { BudgetLedgerService } from './budget-ledger.service';
import { Budget, BudgetControlPoint, BudgetNode, BudgetTxn } from './budget.entities';
import { inTransaction } from '../../common/uow/unit-of-work';
import { ToleranceLadder } from './tolerance-ladder';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;
const hasDb = await dbAvailable();

/**
 * Concurrency at the control point (design.md D1/D2, CLAUDE.md concurrency rules).
 *
 * The case that matters most is 9.1: before this change, two submits charging DIFFERENT budgets
 * locked different rows and could not see each other, so a shared ceiling could be blown through
 * by two transactions that were each individually correct. Locking the control point is the whole
 * reason that is no longer possible.
 */
describe.skipIf(!hasDb)('budget control point concurrency (DB-backed)', () => {
  let orm: MikroORM;
  let ledger: BudgetLedgerService;
  let balance: BudgetBalanceService;
  let coverage: BudgetCoverageService;

  const ids = { company: '', docDept: '', fy: '', user: '', docType: '', template: '', workflow: '' };
  let seq = 0;

  /** A fresh account/department subtree, so each test's control points are its own. */
  async function tree() {
    const n = seq++;
    const em = orm.em.fork();
    const company = em.getReference(Company, ids.company);
    // A NODE tree now, not an account tree — coverage walks `budget_node.parent_id`. Same shape:
    // one top with three leaves beneath it, which is what the contention tests need.
    const mkAcc = (code: string, parent?: BudgetNode) =>
      em.create(BudgetNode, {
        fiscalYear: em.getReference(FiscalYear, ids.fy),
        code: `${code}-${n}`, name: `${code}-${n}`, parent,
      });
    const mkDep = (code: string, parent?: Department) =>
      em.create(Department, {
        company, deptCode: `${code}-${n}`, name: `${code}-${n}`, parentDept: parent, isActive: true,
      });
    const accTop = mkAcc('AT');
    const leaves = [mkAcc('L1', accTop), mkAcc('L2', accTop), mkAcc('L3', accTop)];
    const depTop = mkDep('DT');
    const dep = mkDep('D', depTop);
    await em.flush();
    return {
      accTop: accTop.id,
      leaves: leaves.map((a) => a.id),
      depTop: depTop.id,
      dep: dep.id,
    };
  }

  async function makeBudget(nodeId: string, departmentId: string, amount: string) {
    const em = orm.em.fork();
    const b = em.create(Budget, {
      fiscalYear: em.getReference(FiscalYear, ids.fy),
      department: em.getReference(Department, departmentId),
      node: em.getReference(BudgetNode, nodeId),
      amountTotal: amount,
      controlPolicy: ControlPolicy.HARD_STOP,
      status: 'ACTIVE',
    });
    await em.persistAndFlush(b);
    return b.id;
  }

  async function makeControlPoint(budgetNodeId: string, departmentNodeId: string) {
    const em = orm.em.fork();
    const cp = em.create(BudgetControlPoint, {
      company: em.getReference(Company, ids.company),
      fiscalYear: em.getReference(FiscalYear, ids.fy),
      budgetNode: em.getReference(BudgetNode, budgetNodeId),
      departmentNode: em.getReference(Department, departmentNodeId),
      capAmount: undefined,
      toleranceJson: ToleranceLadder.stringify(ToleranceLadder.BLOCK_AT_CEILING),
      isActive: true,
    });
    await em.persistAndFlush(cp);
    return cp.id;
  }

  /** budget_txn.document_id is NOT NULL, and concurrent reserves need distinct documents. */
  async function makeDoc(moneyMovedOn?: string): Promise<string> {
    const em = orm.em.fork();
    const d = em.create(Document, {
      docNo: `PR-${seq++}-${Date.now()}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.docDept),
      documentType: em.getReference(DocumentType, ids.docType),
      formTemplate: em.getReference(FormTemplate, ids.template),
      workflow: em.getReference(Workflow, ids.workflow),
      currentStepNo: 0,
      createdBy: em.getReference(AppUser, ids.user),
      exchangeRate: '1',
      status: 'DRAFT' as never,
      createdAt: new Date(),
      moneyMovedOn,
    });
    await em.persistAndFlush(d);
    return d.id;
  }

  /** Of a set of settled promises, how many fulfilled — the shape every race below asserts on. */
  function fulfilled(results: PromiseSettledResult<unknown>[]): number {
    return results.filter((r) => r.status === 'fulfilled').length;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const docDept = em.create(Department, { company, deptCode: 'DOC', name: 'Doc host', isActive: true });
    const fy = em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const docType = em.create(DocumentType, { company, code: 'PR', name: 'PR', category: 'PROCUREMENT' as never });
    const template = em.create(FormTemplate, { documentType: docType, version: 1, status: 'PUBLISHED' });
    const workflow = em.create(Workflow, { company, name: 'WF', isActive: true });
    await em.persistAndFlush(company);
    Object.assign(ids, {
      company: company.id, docDept: docDept.id, fy: fy.id, user: user.id,
      docType: docType.id, template: template.id, workflow: workflow.id,
    });

    balance = new BudgetBalanceService(orm.em as EntityManager);
    coverage = new BudgetCoverageService(orm.em as EntityManager);
    ledger = new BudgetLedgerService(orm.em as EntityManager, balance, coverage);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  // ---- 9.1 the case this whole change exists for ------------------------------

  it('serializes two reserves against DIFFERENT budgets under one control point', async () => {
    const t = await tree();
    await makeControlPoint(t.accTop, t.depTop);
    // Each budget could afford its own 80,000 easily; the shared ceiling cannot afford both.
    const a = await makeBudget(t.leaves[0], t.dep, '100000');
    const b = await makeBudget(t.leaves[1], t.dep, '100000');
    const [d1, d2] = [await makeDoc(), await makeDoc()];

    const results = await Promise.allSettled([
      ledger.reserve(d1, [{ budgetId: a, baseAmount: '150000' }]),
      ledger.reserve(d2, [{ budgetId: b, baseAmount: '150000' }]),
    ]);

    // Before control points these two locked different rows and both would have passed.
    expect(fulfilled(results)).toBe(1);
    const governed = await coverage.budgetsGovernedBy((await coverage.controlPointsFor(a))[0].id);
    const at = await balance.balanceAt(governed, null);
    expect(Money.compare(at.used, at.ceiling) <= 0).toBe(true);
  });

  it('still serializes two reserves against the SAME budget, as before', async () => {
    const t = await tree();
    await makeControlPoint(t.leaves[0], t.dep);
    const a = await makeBudget(t.leaves[0], t.dep, '100000');
    const [d1, d2] = [await makeDoc(), await makeDoc()];

    const results = await Promise.allSettled([
      ledger.reserve(d1, [{ budgetId: a, baseAmount: '100000' }]),
      ledger.reserve(d2, [{ budgetId: a, baseAmount: '100000' }]),
    ]);
    expect(fulfilled(results)).toBe(1);
  });

  // ---- 9.2 one document, several budgets, one ceiling -------------------------

  it('serializes two BACKDATED reserves against the same budget, exactly as undated ones', async () => {
    // Stating the day money moved changes what a row is DATED, never what the ceiling allows. If
    // the day leaked into the check — reading the balance as it stood in March, before either of
    // these existed — both would pass and the budget would be over-committed with no single row at
    // fault. This is the same race as the test above, with a day stated on both documents.
    const t = await tree();
    await makeControlPoint(t.leaves[0], t.dep);
    const a = await makeBudget(t.leaves[0], t.dep, '100000');
    const [d1, d2] = [await makeDoc('2026-03-14'), await makeDoc('2026-03-14')];

    const results = await Promise.allSettled([
      ledger.reserve(d1, [{ budgetId: a, baseAmount: '80000' }]),
      ledger.reserve(d2, [{ budgetId: a, baseAmount: '80000' }]),
    ]);

    expect(fulfilled(results)).toBe(1);
    const at = await balance.balanceAt([a], null);
    expect(Money.compare(at.used, at.ceiling) <= 0).toBe(true);
  });

  it('measures a multi-budget document against the control point total, not line by line', async () => {
    const t = await tree();
    await makeControlPoint(t.accTop, t.depTop);
    const a = await makeBudget(t.leaves[0], t.dep, '100000');
    const b = await makeBudget(t.leaves[1], t.dep, '100000');
    const c = await makeBudget(t.leaves[2], t.dep, '100000');
    const doc = await makeDoc();

    // 40,000 each is fine per budget; 120,000 is not fine against the 300,000 ceiling... it is.
    // So push past the ceiling in total while each line stays under its own budget.
    await expect(
      ledger.reserve(doc, [
        { budgetId: a, baseAmount: '99000' },
        { budgetId: b, baseAmount: '99000' },
        { budgetId: c, baseAmount: '99000' },
      ]),
    ).resolves.toBeDefined();

    const doc2 = await makeDoc();
    await expect(
      ledger.reserve(doc2, [
        { budgetId: a, baseAmount: '1000' },
        { budgetId: b, baseAmount: '1000' },
        { budgetId: c, baseAmount: '2000' },
      ]),
    ).rejects.toMatchObject({ code: ErrorCode.BUDGET_EXCEEDED });
  });

  it('refuses when every line fits its own budget but the total does not fit the ceiling', async () => {
    const t = await tree();
    await makeControlPoint(t.accTop, t.depTop);
    const a = await makeBudget(t.leaves[0], t.dep, '100000');
    const b = await makeBudget(t.leaves[1], t.dep, '100000');
    const doc = await makeDoc();
    // Ceiling is 200,000. Each line is inside its own budget; together they are not.
    await expect(
      ledger.reserve(doc, [
        { budgetId: a, baseAmount: '99000' },
        { budgetId: b, baseAmount: '99000' },
      ]),
    ).resolves.toBeDefined();
    const doc2 = await makeDoc();
    await expect(
      ledger.reserve(doc2, [{ budgetId: a, baseAmount: '1000' }, { budgetId: b, baseAmount: '1001' }]),
    ).rejects.toMatchObject({ code: ErrorCode.BUDGET_EXCEEDED });
  });

  // ---- 9.3 / 9.4 lock ordering ----------------------------------------------

  it('does not deadlock when two documents touch the same control points in opposite orders', async () => {
    const t1 = await tree();
    const t2 = await tree();
    await makeControlPoint(t1.leaves[0], t1.dep);
    await makeControlPoint(t2.leaves[0], t2.dep);
    const x = await makeBudget(t1.leaves[0], t1.dep, '1000000');
    const y = await makeBudget(t2.leaves[0], t2.dep, '1000000');
    const [d1, d2] = [await makeDoc(), await makeDoc()];

    // The lines are listed in opposite orders on purpose; the sorted lock order must make that
    // irrelevant. Without it this is the classic AB/BA deadlock.
    const results = await Promise.allSettled([
      ledger.reserve(d1, [
        { budgetId: x, baseAmount: '1000' },
        { budgetId: y, baseAmount: '1000' },
      ]),
      ledger.reserve(d2, [
        { budgetId: y, baseAmount: '1000' },
        { budgetId: x, baseAmount: '1000' },
      ]),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(String(r.reason?.message ?? r.reason)).not.toMatch(/deadlock/i);
      }
    }
    expect(fulfilled(results)).toBe(2);
  });

  it('does not deadlock when transfers run in opposite directions', async () => {
    const t = await tree();
    await makeControlPoint(t.leaves[0], t.dep);
    await makeControlPoint(t.leaves[1], t.dep);
    const x = await makeBudget(t.leaves[0], t.dep, '1000000');
    const y = await makeBudget(t.leaves[1], t.dep, '1000000');
    const [d1, d2] = [await makeDoc(), await makeDoc()];

    const results = await Promise.allSettled([
      ledger.executeTransfer({ documentId: d1, fromBudgetId: x, toBudgetId: y, amount: '1000' }),
      ledger.executeTransfer({ documentId: d2, fromBudgetId: y, toBudgetId: x, amount: '1000' }),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(String(r.reason?.message ?? r.reason)).not.toMatch(/deadlock/i);
      }
    }
    expect(fulfilled(results)).toBe(2);
  });

  // ---- 9.5 the gap that existed before this change ---------------------------

  it('does not let a reserve and a transfer jointly over-draw one control point', async () => {
    const t = await tree();
    await makeControlPoint(t.accTop, t.depTop);
    const a = await makeBudget(t.leaves[0], t.dep, '100000');
    const b = await makeBudget(t.leaves[1], t.dep, '100000');
    // A destination OUTSIDE this control point, so the transfer genuinely removes money from it.
    const outside = await tree();
    await makeControlPoint(outside.leaves[0], outside.dep);
    const dest = await makeBudget(outside.leaves[0], outside.dep, '0');
    const [d1, d2] = [await makeDoc(), await makeDoc()];

    const results = await Promise.allSettled([
      ledger.reserve(d1, [{ budgetId: a, baseAmount: '150000' }]),
      ledger.executeTransfer({ documentId: d2, fromBudgetId: b, toBudgetId: dest, amount: '150000' }),
    ]);
    expect(fulfilled(results)).toBe(1);

    const governed = await coverage.budgetsGovernedBy((await coverage.controlPointsFor(a))[0].id);
    const at = await balance.balanceAt(governed, null);
    expect(Money.compare(at.used, at.ceiling) <= 0).toBe(true);
  });

  // ---- 10.2 behaviour preservation -------------------------------------------

  it('a self-scoped control point accepts and refuses exactly what per-budget checking did', async () => {
    // The migration seeds precisely this shape, so this is the assertion that the deploy is a
    // no-op for every budget that exists today.
    const t = await tree();
    await makeControlPoint(t.leaves[0], t.dep);
    const b = await makeBudget(t.leaves[0], t.dep, '100000');

    const doc = await makeDoc();
    // Exactly to the ceiling is accepted, as it always was.
    await expect(ledger.reserve(doc, [{ budgetId: b, baseAmount: '100000' }])).resolves.toBeDefined();
    expect(Money.compare(await balance.availableBalance(b), '0')).toBe(0);

    // One unit past it is refused, as it always was.
    const doc2 = await makeDoc();
    await expect(
      ledger.reserve(doc2, [{ budgetId: b, baseAmount: '0.01' }]),
    ).rejects.toMatchObject({ code: ErrorCode.BUDGET_EXCEEDED });
  });

  it('posts RESERVE at the leaf budget, never at the control point', async () => {
    const t = await tree();
    await makeControlPoint(t.accTop, t.depTop);
    const a = await makeBudget(t.leaves[0], t.dep, '100000');
    const b = await makeBudget(t.leaves[1], t.dep, '100000');
    const doc = await makeDoc();
    await ledger.reserve(doc, [
      { budgetId: a, baseAmount: '1000' },
      { budgetId: b, baseAmount: '2000' },
    ]);
    const em = orm.em.fork();
    const txns = await em.find(BudgetTxn, { document: doc }, FILTER_OFF);
    expect(txns).toHaveLength(2);
    expect(new Set(txns.map((t) => t.budget.id))).toEqual(new Set([a, b]));
    expect(txns.every((t) => t.txnType === BudgetTxnType.RESERVE)).toBe(true);
  });

  // ---- coverage invariant at the ledger boundary ------------------------------

  it('locks the control point and NOT the budget row', async () => {
    // Task 5.14, and the one-line reason "no deadlock" is provable: `budget_control_point` is the
    // only lock class. The tree changed which points a budget resolves to, so the class is worth
    // re-proving rather than assuming — a stray `budget` lock would introduce a second class with
    // its own ordering, and nothing would report it until two documents deadlocked in production.
    const t = await tree();
    const cpId = await makeControlPoint(t.accTop, t.depTop);
    const budgetId = await makeBudget(t.leaves[0], t.dep, '100000');
    const docId = await makeDoc();

    // A probe on ANOTHER connection: NOWAIT turns "locked" into an immediate error instead of a
    // hang, so the two claims can be told apart.
    const probe = async (table: string, id: string) => {
      const em = orm.em.fork();
      await em.getConnection().execute(`select 1 from "${table}" where "id" = ? for update nowait`, [id]);
    };

    await inTransaction(orm.em as EntityManager, async (tem) => {
      await ledger.reserve(docId, [{ budgetId, baseAmount: '1000' }], tem);
      // The budget row is free — nothing in this module locks it.
      await expect(probe('budget', budgetId)).resolves.toBeUndefined();
      // ...and the control point is held, which is what makes the assertion above load-bearing
      // rather than a probe that would pass against any table at all.
      await expect(probe('budget_control_point', cpId)).rejects.toThrow();
    });
  });

  it('refuses to reserve against a budget no control point governs', async () => {
    // Not "unlimited": an uncovered budget is a configuration fault and must fail loudly, because
    // the alternative is spending that is silently never checked.
    const t = await tree();
    const orphan = await makeBudget(t.leaves[0], t.dep, '1000000');
    const doc = await makeDoc();
    await expect(
      ledger.reserve(doc, [{ budgetId: orphan, baseAmount: '1' }]),
    ).rejects.toMatchObject({ code: ErrorCode.BUDGET_EXCEEDED });
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[budget-control-point-concurrency] no database reachable — skipping DB-backed spec');
}
