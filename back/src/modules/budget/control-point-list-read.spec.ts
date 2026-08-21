import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { BudgetTxnType, ControlPolicy } from '../../common/enums';
import { Money } from '../../common/money/money';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Account } from '../accounting/accounting.entities';
import { Workflow } from '../approval/approval.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetControlPointService } from './budget-control-point.service';
import { BudgetCoverageService } from './budget-coverage.service';
import { Budget, BudgetControlPoint, BudgetNode, BudgetTxn } from './budget.entities';
import { ToleranceLadder } from './tolerance-ladder';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

// Fixtures write budget rows directly; `budget_txn.txn_date` is the day of the event and is
// not nullable, so a fixture must state one just as the ledger service does.
const TODAY = new Date().toISOString().slice(0, 10);

const FILTER_OFF = { filters: { company: false } } as const;
const hasDb = await dbAvailable();

/**
 * The widened control-point list read.
 *
 * A control point has no `budget` row, so a screen listing points has nowhere else to get a ceiling
 * from. Carrying the derived figures on the list row is what stops that screen becoming one request
 * per category — and the figures must agree, to the unit, with the single-point balance read.
 */
describe.skipIf(!hasDb)('control point list read (DB-backed)', () => {
  let orm: MikroORM;
  let service: BudgetControlPointService;
  let coverage: BudgetCoverageService;
  let balance: BudgetBalanceService;

  const ids = { companyA: '', companyB: '', fyA: '', fyB: '', deptB: '', accB: '', budgetB: '', doc: '' };
  let seq = 0;

  function asCtx<T>(fn: () => Promise<T>, companyId = ids.companyA): Promise<T> {
    return RequestContext.run({ companyId, grants: [] }, fn);
  }

  /**
   * A department tree and a NODE to hang points on.
   *
   * This built an ACCOUNT tree — a non-postable parent with two postable children — until coverage
   * moved off it. The parent is a `budget_node` now, which is what a category actually is: it holds
   * no amount because it has no amount column, not because a rule forbids one. The department tree
   * is unchanged, because that half of coverage did not move.
   */
  async function tree() {
    const n = seq++;
    const em = orm.em.fork();
    const company = em.getReference(Company, ids.companyA);
    const dTop = em.create(Department, { company, deptCode: `DT-${n}`, name: `DT-${n}`, isActive: true });
    const d = em.create(Department, { company, deptCode: `D-${n}`, name: `D-${n}`, parentDept: dTop, isActive: true });
    const parent = em.create(BudgetNode, {
      fiscalYear: em.getReference(FiscalYear, ids.fyA),
      code: `P-${n}`,
      name: `P-${n}`,
    });
    await em.persistAndFlush([dTop, d, parent]);
    return { parent: parent.id, dTop: dTop.id, d: d.id, n };
  }

  /** A budget at a node beneath `parentId` — the only thing that holds money or is charged. */
  async function makeBudget(parentId: string, departmentId: string, amount: string) {
    const em = orm.em.fork();
    const parent = await em.findOneOrFail(BudgetNode, { id: parentId }, FILTER_OFF);
    const node = em.create(BudgetNode, {
      fiscalYear: em.getReference(FiscalYear, ids.fyA),
      code: `${parent.code}.${seq++}`,
      parent,
    });
    const b = em.create(Budget, {
      fiscalYear: em.getReference(FiscalYear, ids.fyA),
      department: em.getReference(Department, departmentId),
      node,
      amountTotal: amount,
      controlPolicy: ControlPolicy.HARD_STOP,
      status: 'ACTIVE',
    });
    await em.persistAndFlush(b);
    return b.id;
  }

  /** The node a budget's money sits at — what a point governing exactly that budget hangs on. */
  async function nodeOf(budgetId: string): Promise<string> {
    const b = await orm.em.fork().findOneOrFail(Budget, { id: budgetId }, { ...FILTER_OFF, populate: ['node'] });
    return b.node.id;
  }

  async function makeCp(budgetNodeId: string, departmentNodeId: string, companyId = ids.companyA, fyId = ids.fyA) {
    const em = orm.em.fork();
    const cp = em.create(BudgetControlPoint, {
      company: em.getReference(Company, companyId),
      fiscalYear: em.getReference(FiscalYear, fyId),
      budgetNode: em.getReference(BudgetNode, budgetNodeId),
      departmentNode: em.getReference(Department, departmentNodeId),
      capAmount: undefined,
      toleranceJson: ToleranceLadder.stringify(ToleranceLadder.BLOCK_AT_CEILING),
      isActive: true,
    });
    await em.persistAndFlush(cp);
    return cp.id;
  }

  async function txn(budgetId: string, type: BudgetTxnType, amount: string) {
    const em = orm.em.fork();
    em.create(BudgetTxn, {
      budget: em.getReference(Budget, budgetId),
      document: em.getReference(Document, ids.doc),
      txnType: type, txnDate: TODAY, amount, createdAt: new Date(),
    });
    await em.flush();
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const companyB = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'HOST', name: 'Host', isActive: true });
    const deptB = em.create(Department, { company: companyB, deptCode: 'DB', name: 'DB', isActive: true });
    const accB = em.create(Account, { company: companyB, code: 'B1', name: 'B1', accountType: 'EXPENSE' as never, isPostable: true, isActive: true });
    const fyA = em.create(FiscalYear, { company: companyA, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const fyB = em.create(FiscalYear, { company: companyB, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    // Company B's own budget node, so the cross-company point has somewhere of its OWN to sit —
    // aiming it at company A's node would test nothing, since the point would then be in A's tree.
    const budgetB = em.create(BudgetNode, { fiscalYear: fyB, code: 'B-ROOT' });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const dt = em.create(DocumentType, { company: companyA, code: 'PR', name: 'PR', category: 'PROCUREMENT' as never });
    const tpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company: companyA, name: 'WF', isActive: true });
    const doc = em.create(Document, {
      docNo: 'PR-1', company: companyA, department: deptA, documentType: dt, formTemplate: tpl,
      workflow: wf, currentStepNo: 0, createdBy: user, exchangeRate: '1',
      status: 'DRAFT' as never, createdAt: new Date(),
    });
    await em.persistAndFlush([companyA, companyB, accB, budgetB, doc]);
    Object.assign(ids, {
      companyA: companyA.id, companyB: companyB.id, fyA: fyA.id, fyB: fyB.id,
      deptB: deptB.id, accB: accB.id, budgetB: budgetB.id, doc: doc.id,
    });

    balance = new BudgetBalanceService(orm.em as EntityManager);
    coverage = new BudgetCoverageService(orm.em as EntityManager);
    service = new BudgetControlPointService(orm.em as EntityManager, coverage, balance);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('reports figures identical to the single-point balance read', async () => {
    // Every txn type in play, so a term dropped from the batched formula shows up as a mismatch.
    const t = await tree();
    const cpId = await makeCp(t.parent, t.dTop);
    const a = await makeBudget(t.parent, t.d, '350000000');
    const b = await makeBudget(t.parent, t.d, '184000000');
    await txn(a, BudgetTxnType.RESERVE, '162208500');
    await txn(a, BudgetTxnType.ACTUAL, '100000000');
    await txn(b, BudgetTxnType.RELEASE, '5000000');
    await txn(b, BudgetTxnType.ADJUST_INCREASE, '2000000');
    await txn(b, BudgetTxnType.ADJUST_DECREASE, '1000000');
    await txn(b, BudgetTxnType.TRANSFER_IN, '3000000');
    await txn(b, BudgetTxnType.TRANSFER_OUT, '4000000');

    const row = (await asCtx(() => service.list(ids.fyA))).find((r) => r.id === cpId)!;
    const single = await balance.balanceAt(await coverage.budgetsGovernedBy(cpId), null);

    expect(Money.compare(row.available, single.available)).toBe(0);
    expect(Money.compare(row.ceiling, single.ceiling)).toBe(0);
    expect(Money.compare(row.used, single.used)).toBe(0);
    // ...and against the endpoint the detail screen uses.
    const viaBalanceOf = await asCtx(() => service.balanceOf(cpId));
    expect(Money.compare(row.available, viaBalanceOf.available)).toBe(0);
  });

  it('carries the ids of every budget it governs', async () => {
    const t = await tree();
    const cpId = await makeCp(t.parent, t.dTop);
    const a = await makeBudget(t.parent, t.d, '100');
    const b = await makeBudget(t.parent, t.d, '200');
    // Genuinely outside: a different department subtree AND a different budget subtree. Under one
    // of them alone it would still be governed — a control point's two trees both have to miss.
    const other = await tree();
    const outside = await makeBudget(other.parent, other.d, '400');

    const row = (await asCtx(() => service.list(ids.fyA))).find((r) => r.id === cpId)!;
    expect(row.governedBudgetIds).toEqual(expect.arrayContaining([a, b]));
    expect(row.governedBudgetIds).not.toContain(outside);
    expect(row.governedBudgetIds).toHaveLength(2);
  });

  it('reports zero for a point that governs nothing, never unlimited', async () => {
    const t = await tree();
    const cpId = await makeCp(t.parent, t.dTop);
    const row = (await asCtx(() => service.list(ids.fyA))).find((r) => r.id === cpId)!;
    expect(row.ceiling).toBe('0');
    expect(row.available).toBe('0');
    expect(row.governedBudgetIds).toEqual([]);
  });

  it('keeps overlapping groups independent', async () => {
    // A budget governed by two points counts once in EACH — that is what makes a group's available
    // mean "what this ceiling has left" rather than a share of something.
    const t = await tree();
    const wide = await makeCp(t.parent, t.dTop);
    const shared = await makeBudget(t.parent, t.d, '100000');
    await makeBudget(t.parent, t.d, '400000');
    // The narrow point sits on the LEAF, which is where a point governing exactly one budget now
    // goes: it used to sit on that budget's own account, and a leaf budget is the same idea.
    const narrow = await makeCp(await nodeOf(shared), t.d);
    await txn(shared, BudgetTxnType.RESERVE, '40000');

    const rows = await asCtx(() => service.list(ids.fyA));
    const w = rows.find((r) => r.id === wide)!;
    const n = rows.find((r) => r.id === narrow)!;
    expect(Money.compare(w.ceiling, '500000')).toBe(0);
    expect(Money.compare(w.available, '460000')).toBe(0);
    expect(Money.compare(n.ceiling, '100000')).toBe(0);
    expect(Money.compare(n.available, '60000')).toBe(0);
  });

  it('is scoped to the active company', async () => {
    const t = await tree();
    await makeCp(t.parent, t.dTop);
    const foreign = await makeCp(ids.budgetB, ids.deptB, ids.companyB, ids.fyB);
    const rows = await asCtx(() => service.list());
    expect(rows.map((r) => r.id)).not.toContain(foreign);
  });

  it('filters to a fiscal year when asked', async () => {
    const t = await tree();
    const thisYear = await makeCp(t.parent, t.dTop);
    const rows = await asCtx(() => service.list(ids.fyA));
    expect(rows.map((r) => r.id)).toContain(thisYear);
    expect(rows.every((r) => r.fiscalYearId === ids.fyA)).toBe(true);
  });

  it('still carries the configuration fields the admin screens use', async () => {
    const t = await tree();
    const cpId = await makeCp(t.parent, t.d);
    const row = (await asCtx(() => service.list(ids.fyA))).find((r) => r.id === cpId)!;
    expect(row.tolerance).toEqual([{ at: 100, action: 'BLOCK' }]);
    expect(row.capAmount).toBeNull();
    expect(row.isActive).toBe(true);
    expect(row.budgetNodeCode).toBeTruthy();
    expect(row.departmentNodeCode).toBeTruthy();
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[control-point-list-read] no database reachable — skipping DB-backed spec');
}
