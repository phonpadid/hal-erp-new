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
import { Budget, BudgetControlPoint, BudgetTxn } from './budget.entities';
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

  const ids = { companyA: '', companyB: '', fyA: '', fyB: '', deptB: '', accB: '', doc: '' };
  let seq = 0;

  function asCtx<T>(fn: () => Promise<T>, companyId = ids.companyA): Promise<T> {
    return RequestContext.run({ companyId, grants: [] }, fn);
  }

  async function tree() {
    const n = seq++;
    const em = orm.em.fork();
    const company = em.getReference(Company, ids.companyA);
    const top = em.create(Account, { company, code: `T-${n}`, name: `T-${n}`, accountType: 'EXPENSE' as never, isPostable: false, isActive: true });
    const l1 = em.create(Account, { company, code: `A-${n}`, name: `A-${n}`, accountType: 'EXPENSE' as never, parent: top, isPostable: true, isActive: true });
    const l2 = em.create(Account, { company, code: `B-${n}`, name: `B-${n}`, accountType: 'EXPENSE' as never, parent: top, isPostable: true, isActive: true });
    const dTop = em.create(Department, { company, deptCode: `DT-${n}`, name: `DT-${n}`, isActive: true });
    const d = em.create(Department, { company, deptCode: `D-${n}`, name: `D-${n}`, parentDept: dTop, isActive: true });
    await em.flush();
    return { top: top.id, l1: l1.id, l2: l2.id, dTop: dTop.id, d: d.id };
  }

  async function makeBudget(accountId: string, departmentId: string, amount: string) {
    const em = orm.em.fork();
    const account = await em.findOneOrFail(Account, { id: accountId }, FILTER_OFF);
    const b = em.create(Budget, {
      fiscalYear: em.getReference(FiscalYear, ids.fyA),
      department: em.getReference(Department, departmentId),
      glAccount: account.code, account, amountTotal: amount,
      controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE',
    });
    await em.persistAndFlush(b);
    return b.id;
  }

  async function makeCp(accountNodeId: string, departmentNodeId: string, companyId = ids.companyA, fyId = ids.fyA) {
    const em = orm.em.fork();
    const cp = em.create(BudgetControlPoint, {
      company: em.getReference(Company, companyId),
      fiscalYear: em.getReference(FiscalYear, fyId),
      accountNode: em.getReference(Account, accountNodeId),
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
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const dt = em.create(DocumentType, { company: companyA, code: 'PR', name: 'PR', category: 'PROCUREMENT' as never });
    const tpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company: companyA, name: 'WF', isActive: true });
    const doc = em.create(Document, {
      docNo: 'PR-1', company: companyA, department: deptA, documentType: dt, formTemplate: tpl,
      workflow: wf, currentStepNo: 0, createdBy: user, exchangeRate: '1',
      status: 'DRAFT' as never, createdAt: new Date(),
    });
    await em.persistAndFlush([companyA, companyB, accB, doc]);
    Object.assign(ids, {
      companyA: companyA.id, companyB: companyB.id, fyA: fyA.id, fyB: fyB.id,
      deptB: deptB.id, accB: accB.id, doc: doc.id,
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
    const cpId = await makeCp(t.top, t.dTop);
    const a = await makeBudget(t.l1, t.d, '350000000');
    const b = await makeBudget(t.l2, t.d, '184000000');
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
    const cpId = await makeCp(t.top, t.dTop);
    const a = await makeBudget(t.l1, t.d, '100');
    const b = await makeBudget(t.l2, t.d, '200');
    // Genuinely outside: a different department subtree entirely. A budget at (t.l1, t.dTop) would
    // NOT be outside — dTop is ancestor-or-self of itself, so this point governs that too.
    const other = await tree();
    const outside = await makeBudget(other.l1, other.d, '400');

    const row = (await asCtx(() => service.list(ids.fyA))).find((r) => r.id === cpId)!;
    expect(row.governedBudgetIds).toEqual(expect.arrayContaining([a, b]));
    expect(row.governedBudgetIds).not.toContain(outside);
    expect(row.governedBudgetIds).toHaveLength(2);
  });

  it('reports zero for a point that governs nothing, never unlimited', async () => {
    const t = await tree();
    const cpId = await makeCp(t.top, t.dTop);
    const row = (await asCtx(() => service.list(ids.fyA))).find((r) => r.id === cpId)!;
    expect(row.ceiling).toBe('0');
    expect(row.available).toBe('0');
    expect(row.governedBudgetIds).toEqual([]);
  });

  it('keeps overlapping groups independent', async () => {
    // A budget governed by two points counts once in EACH — that is what makes a group's available
    // mean "what this ceiling has left" rather than a share of something.
    const t = await tree();
    const wide = await makeCp(t.top, t.dTop);
    const narrow = await makeCp(t.l1, t.d);
    const shared = await makeBudget(t.l1, t.d, '100000');
    await makeBudget(t.l2, t.d, '400000');
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
    await makeCp(t.top, t.dTop);
    const foreign = await makeCp(ids.accB, ids.deptB, ids.companyB, ids.fyB);
    const rows = await asCtx(() => service.list());
    expect(rows.map((r) => r.id)).not.toContain(foreign);
  });

  it('filters to a fiscal year when asked', async () => {
    const t = await tree();
    const thisYear = await makeCp(t.top, t.dTop);
    const rows = await asCtx(() => service.list(ids.fyA));
    expect(rows.map((r) => r.id)).toContain(thisYear);
    expect(rows.every((r) => r.fiscalYearId === ids.fyA)).toBe(true);
  });

  it('still carries the configuration fields the admin screens use', async () => {
    const t = await tree();
    const cpId = await makeCp(t.l1, t.d);
    const row = (await asCtx(() => service.list(ids.fyA))).find((r) => r.id === cpId)!;
    expect(row.tolerance).toEqual([{ at: 100, action: 'BLOCK' }]);
    expect(row.capAmount).toBeNull();
    expect(row.isActive).toBe(true);
    expect(row.accountNodeCode).toBeTruthy();
    expect(row.departmentNodeCode).toBeTruthy();
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[control-point-list-read] no database reachable — skipping DB-backed spec');
}
