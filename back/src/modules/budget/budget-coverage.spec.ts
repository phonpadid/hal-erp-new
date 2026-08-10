import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BudgetTxnType, ControlPolicy } from '../../common/enums';
import { Money } from '../../common/money/money';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Account } from '../accounting/accounting.entities';
import { Workflow } from '../approval/approval.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetCoverageService } from './budget-coverage.service';
import { Budget, BudgetControlPoint, BudgetTxn } from './budget.entities';
import { ToleranceLadder } from './tolerance-ladder';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

/**
 * Coverage resolution and the widened balance read (design.md D3, D4, D5).
 *
 * Every test builds its OWN subtree, because `budget` is unique per
 * (fiscal_year, department, gl_account) and `budget_control_point` per
 * (company, fiscal_year, account_node, department_node) — sharing nodes between tests would
 * collide rather than isolate. Each `tree()` is shaped:
 *
 *   accounts                          departments
 *     top   (not postable)              dTop
 *     └ mid (not postable)              └ dMid
 *       ├ leafA (postable)                ├ dLeafA
 *       └ leafB (postable)                └ dLeafB
 */
describe.skipIf(!hasDb)('budget coverage + control-point balance (DB-backed)', () => {
  let orm: MikroORM;
  let coverage: BudgetCoverageService;
  let balance: BudgetBalanceService;

  const ids = { companyA: '', companyB: '', fyA: '', fyA2: '', fyB: '', docA: '', deptB: '', accB: '' };
  let seq = 0;

  interface Tree {
    top: string;
    mid: string;
    leafA: string;
    leafB: string;
    dTop: string;
    dMid: string;
    dLeafA: string;
    dLeafB: string;
  }

  /** A fresh account subtree + department subtree in company A, isolated from every other test. */
  async function tree(): Promise<Tree> {
    const n = seq++;
    const em = orm.em.fork();
    const companyA = em.getReference(Company, ids.companyA);
    const acc = (code: string, parent?: Account, postable = false) =>
      em.create(Account, {
        company: companyA,
        code: `${code}-${n}`,
        name: `${code}-${n}`,
        accountType: 'EXPENSE' as any,
        parent,
        isPostable: postable,
        isActive: true,
      });
    const dep = (code: string, parent?: Department) =>
      em.create(Department, {
        company: companyA,
        deptCode: `${code}-${n}`,
        name: `${code}-${n}`,
        parentDept: parent,
        isActive: true,
      });

    const top = acc('TOP');
    const mid = acc('MID', top);
    const leafA = acc('LA', mid, true);
    const leafB = acc('LB', mid, true);
    const dTop = dep('DTOP');
    const dMid = dep('DMID', dTop);
    const dLeafA = dep('DLA', dMid);
    const dLeafB = dep('DLB', dMid);
    await em.flush();
    return {
      top: top.id,
      mid: mid.id,
      leafA: leafA.id,
      leafB: leafB.id,
      dTop: dTop.id,
      dMid: dMid.id,
      dLeafA: dLeafA.id,
      dLeafB: dLeafB.id,
    };
  }

  async function makeBudget(
    accountId: string,
    departmentId: string,
    amountTotal: string,
    fiscalYearId = ids.fyA,
  ): Promise<string> {
    const em = orm.em.fork();
    const account = await em.findOneOrFail(
      Account,
      { id: accountId },
      { filters: { company: false } },
    );
    const b = em.create(Budget, {
      fiscalYear: em.getReference(FiscalYear, fiscalYearId),
      department: em.getReference(Department, departmentId),
      glAccount: account.code,
      account: em.getReference(Account, accountId),
      amountTotal,
      controlPolicy: ControlPolicy.HARD_STOP,
      status: 'ACTIVE',
    });
    await em.persistAndFlush(b);
    return b.id;
  }

  async function makeControlPoint(
    accountNodeId: string,
    departmentNodeId: string,
    opts: { companyId?: string; fiscalYearId?: string; isActive?: boolean; cap?: string } = {},
  ): Promise<string> {
    const em = orm.em.fork();
    const cp = em.create(BudgetControlPoint, {
      company: em.getReference(Company, opts.companyId ?? ids.companyA),
      fiscalYear: em.getReference(FiscalYear, opts.fiscalYearId ?? ids.fyA),
      accountNode: em.getReference(Account, accountNodeId),
      departmentNode: em.getReference(Department, departmentNodeId),
      capAmount: opts.cap,
      toleranceJson: ToleranceLadder.stringify(ToleranceLadder.BLOCK_AT_CEILING),
      isActive: opts.isActive ?? true,
    });
    await em.persistAndFlush(cp);
    return cp.id;
  }

  async function txn(budgetId: string, type: BudgetTxnType, amount: string): Promise<void> {
    const em = orm.em.fork();
    em.create(BudgetTxn, {
      budget: em.getReference(Budget, budgetId),
      document: em.getReference(Document, ids.docA),
      txnType: type,
      amount,
      createdAt: new Date(),
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
    const accB = em.create(Account, { company: companyB, code: 'B-1', name: 'B-1', accountType: 'EXPENSE' as any, isPostable: true, isActive: true });
    const fyA = em.create(FiscalYear, { company: companyA, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const fyA2 = em.create(FiscalYear, { company: companyA, year: 2027, startDate: '2027-01-01', endDate: '2027-12-31', status: 'OPEN' });
    const fyB = em.create(FiscalYear, { company: companyB, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });

    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const docType = em.create(DocumentType, { company: companyA, code: 'PR', name: 'PR', category: 'PROCUREMENT' as any });
    const template = em.create(FormTemplate, { documentType: docType, version: 1, status: 'PUBLISHED' });
    const workflow = em.create(Workflow, { company: companyA, name: 'WF', isActive: true });
    const docA = em.create(Document, {
      docNo: 'PR-A-2026-0001',
      company: companyA,
      department: deptA,
      documentType: docType,
      formTemplate: template,
      workflow,
      currentStepNo: 0,
      createdBy: user,
      exchangeRate: '1',
      status: 'DRAFT' as any,
      createdAt: new Date(),
    });
    await em.persistAndFlush([companyA, companyB, accB, docA]);

    Object.assign(ids, {
      companyA: companyA.id,
      companyB: companyB.id,
      deptB: deptB.id,
      accB: accB.id,
      fyA: fyA.id,
      fyA2: fyA2.id,
      fyB: fyB.id,
      docA: docA.id,
    });

    coverage = new BudgetCoverageService(orm.em as EntityManager);
    balance = new BudgetBalanceService(orm.em as EntityManager);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  describe('a control point governs through BOTH trees', () => {
    it('governs when its nodes are ancestors on both sides', async () => {
      const t = await tree();
      const budgetId = await makeBudget(t.leafA, t.dLeafA, '1000');
      const cpId = await makeControlPoint(t.mid, t.dMid);
      expect((await coverage.controlPointsFor(budgetId)).map((c) => c.id)).toContain(cpId);
    });

    it('governs when its nodes are the budget’s own account and department', async () => {
      // The shape the migration seed relies on: self-scoped points must govern their own budget.
      const t = await tree();
      const budgetId = await makeBudget(t.leafA, t.dLeafA, '1000');
      const cpId = await makeControlPoint(t.leafA, t.dLeafA);
      expect((await coverage.controlPointsFor(budgetId)).map((c) => c.id)).toContain(cpId);
    });

    it('does NOT govern when only the account tree matches', async () => {
      const t = await tree();
      const budgetId = await makeBudget(t.leafA, t.dLeafB, '1000');
      const cpId = await makeControlPoint(t.mid, t.dLeafA);
      expect((await coverage.controlPointsFor(budgetId)).map((c) => c.id)).not.toContain(cpId);
    });

    it('does NOT govern when only the department tree matches', async () => {
      const t = await tree();
      const budgetId = await makeBudget(t.leafB, t.dLeafA, '1000');
      const cpId = await makeControlPoint(t.leafA, t.dMid);
      expect((await coverage.controlPointsFor(budgetId)).map((c) => c.id)).not.toContain(cpId);
    });

    it('returns every governing point, not only the nearest', async () => {
      // Checking only the nearest would make a narrow point a way out of a wider ceiling.
      const t = await tree();
      const budgetId = await makeBudget(t.leafA, t.dLeafA, '1000');
      const own = await makeControlPoint(t.leafA, t.dLeafA);
      const mid = await makeControlPoint(t.mid, t.dMid);
      const top = await makeControlPoint(t.top, t.dTop);
      const got = (await coverage.controlPointsFor(budgetId)).map((c) => c.id);
      expect(got).toEqual(expect.arrayContaining([own, mid, top]));
      expect(got).toHaveLength(3);
    });

    it('may sit on a non-postable account node', async () => {
      // is_postable restricts posting targets, not checkpoints.
      const t = await tree();
      const budgetId = await makeBudget(t.leafA, t.dLeafA, '1000');
      const cpId = await makeControlPoint(t.top, t.dMid);
      expect((await coverage.controlPointsFor(budgetId)).map((c) => c.id)).toContain(cpId);
    });
  });

  describe('scoping', () => {
    it('never governs across companies', async () => {
      const t = await tree();
      const budgetId = await makeBudget(t.leafA, t.dLeafA, '1000');
      const foreign = await makeControlPoint(ids.accB, ids.deptB, {
        companyId: ids.companyB,
        fiscalYearId: ids.fyB,
      });
      expect((await coverage.controlPointsFor(budgetId)).map((c) => c.id)).not.toContain(foreign);
    });

    it('never governs across fiscal years', async () => {
      const t = await tree();
      const budgetId = await makeBudget(t.leafA, t.dLeafA, '1000');
      const otherYear = await makeControlPoint(t.mid, t.dMid, { fiscalYearId: ids.fyA2 });
      expect((await coverage.controlPointsFor(budgetId)).map((c) => c.id)).not.toContain(otherYear);
    });

    it('ignores an inactive control point', async () => {
      const t = await tree();
      const budgetId = await makeBudget(t.leafA, t.dLeafA, '1000');
      const inactive = await makeControlPoint(t.mid, t.dMid, { isActive: false });
      expect((await coverage.controlPointsFor(budgetId)).map((c) => c.id)).not.toContain(inactive);
    });

    it('reports an uncovered budget as an empty set, never as unrestricted', async () => {
      const t = await tree();
      const budgetId = await makeBudget(t.leafA, t.dLeafA, '1000');
      expect(await coverage.controlPointsFor(budgetId)).toEqual([]);
    });
  });

  describe('inverse direction: budgets governed by a point', () => {
    it('collects every budget under both subtrees and nothing outside them', async () => {
      const t = await tree();
      const cpId = await makeControlPoint(t.mid, t.dMid);
      const a = await makeBudget(t.leafA, t.dLeafA, '100');
      const b = await makeBudget(t.leafB, t.dLeafB, '200');
      const outsideDept = await makeBudget(t.leafA, t.dTop, '400');
      const governed = await coverage.budgetsGovernedBy(cpId);
      expect(governed).toEqual(expect.arrayContaining([a, b]));
      expect(governed).not.toContain(outsideDept);
    });
  });

  describe('stranding check', () => {
    it('flags a budget whose only governing point is being deactivated', async () => {
      const t = await tree();
      const budgetId = await makeBudget(t.leafA, t.dLeafA, '100');
      const only = await makeControlPoint(t.leafA, t.dLeafA);
      expect(await coverage.budgetsStrandedByDeactivating(only)).toContain(budgetId);
    });

    it('does not flag a budget another point still governs', async () => {
      const t = await tree();
      const budgetId = await makeBudget(t.leafA, t.dLeafA, '100');
      const one = await makeControlPoint(t.leafA, t.dLeafA);
      await makeControlPoint(t.mid, t.dMid);
      expect(await coverage.budgetsStrandedByDeactivating(one)).not.toContain(budgetId);
    });

    it('ignores budgets that are not ACTIVE', async () => {
      const t = await tree();
      const budgetId = await makeBudget(t.leafA, t.dLeafA, '100');
      const em = orm.em.fork();
      const b = await em.findOneOrFail(Budget, { id: budgetId }, { filters: { company: false } });
      b.status = 'CLOSED';
      await em.flush();
      const only = await makeControlPoint(t.leafA, t.dLeafA);
      expect(await coverage.budgetsStrandedByDeactivating(only)).not.toContain(budgetId);
    });
  });

  describe('balanceAt matches the per-budget read it widens', () => {
    it('is identical to availableBalance for a single-budget control point', async () => {
      // The property the migration seed depends on: one governed budget ⇒ same arithmetic.
      const t = await tree();
      const budgetId = await makeBudget(t.leafA, t.dLeafA, '1000000');
      await txn(budgetId, BudgetTxnType.ADJUST_INCREASE, '200000');
      await txn(budgetId, BudgetTxnType.ADJUST_DECREASE, '50000');
      await txn(budgetId, BudgetTxnType.TRANSFER_IN, '30000');
      await txn(budgetId, BudgetTxnType.TRANSFER_OUT, '10000');
      await txn(budgetId, BudgetTxnType.RESERVE, '400000');
      await txn(budgetId, BudgetTxnType.ACTUAL, '250000');
      await txn(budgetId, BudgetTxnType.RELEASE, '150000');

      const perBudget = await balance.availableBalance(budgetId);
      const atPoint = await balance.balanceAt([budgetId], null);
      expect(atPoint.available).toBe(perBudget);
    });

    it('does not subtract ACTUAL at control-point level either', async () => {
      const t = await tree();
      const budgetId = await makeBudget(t.leafA, t.dLeafA, '100000');
      await txn(budgetId, BudgetTxnType.RESERVE, '40000');
      const before = await balance.balanceAt([budgetId], null);
      await txn(budgetId, BudgetTxnType.ACTUAL, '40000');
      const after = await balance.balanceAt([budgetId], null);
      // Settling a reservation spends money that was already out of the budget.
      expect(after.available).toBe(before.available);
    });

    it('rolls the ceiling up across every governed budget', async () => {
      const t = await tree();
      const cpId = await makeControlPoint(t.mid, t.dMid);
      const a = await makeBudget(t.leafA, t.dLeafA, '350000');
      const b = await makeBudget(t.leafB, t.dLeafB, '184000');
      const governed = await coverage.budgetsGovernedBy(cpId);
      expect(governed).toEqual(expect.arrayContaining([a, b]));
      expect((await balance.balanceAt(governed, null)).ceiling).toBe('534000');
    });

    it('pools spending across the governed budgets', async () => {
      // The point of node control: a line over its own amount is fine while the node holds.
      const t = await tree();
      const cpId = await makeControlPoint(t.mid, t.dMid);
      const small = await makeBudget(t.leafA, t.dLeafA, '24000');
      const large = await makeBudget(t.leafB, t.dLeafB, '510000');
      await txn(small, BudgetTxnType.RESERVE, '162000');
      const governed = await coverage.budgetsGovernedBy(cpId);
      const at = await balance.balanceAt(governed, null);
      expect(at.ceiling).toBe('534000');
      expect(at.used).toBe('162000');
      expect(at.available).toBe('372000');
      // ...while the overspent line on its own is deep in the red. Compared as decimals, not
      // strings: a budget with no transactions returns the raw column value ("510000.00"), one
      // that has been through Money arithmetic returns a normalised one ("510000").
      expect(Money.compare(await balance.availableBalance(small), '-138000')).toBe(0);
      expect(Money.compare(await balance.availableBalance(large), '510000')).toBe(0);
    });

    it('honours an explicit cap over the rollup', async () => {
      const t = await tree();
      const a = await makeBudget(t.leafA, t.dLeafA, '350000');
      const b = await makeBudget(t.leafB, t.dLeafB, '184000');
      const at = await balance.balanceAt([a, b], '400000');
      expect(at.ceiling).toBe('400000');
      expect(at.available).toBe('400000');
    });

    it('treats a control point governing nothing as zero, not unlimited', async () => {
      expect(await balance.balanceAt([], null)).toEqual({
        ceiling: '0',
        used: '0',
        available: '0',
      });
    });
  });

  describe('breakdownAt reconciles to balanceAt', () => {
    it('components add up to the same available', async () => {
      const t = await tree();
      const budgetId = await makeBudget(t.leafA, t.dLeafA, '100000');
      await txn(budgetId, BudgetTxnType.RESERVE, '30000');
      await txn(budgetId, BudgetTxnType.ACTUAL, '20000');
      await txn(budgetId, BudgetTxnType.RELEASE, '10000');
      const at = await balance.balanceAt([budgetId], null);
      const bd = await balance.breakdownAt([budgetId], null);
      expect(bd.available).toBe(at.available);
      expect(bd.amountTotal).toBe(at.ceiling);
      expect(bd.reserved).toBe('30000');
      expect(bd.actual).toBe('20000');
      expect(bd.released).toBe('10000');
    });
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[budget-coverage] no database reachable — skipping DB-backed spec');
}
