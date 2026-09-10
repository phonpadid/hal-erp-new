import { beforeAll, describe, expect, it } from 'vitest';
import { BudgetTxnType } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetCoverageService } from './budget-coverage.service';
import { Budget, BudgetControlPoint, BudgetNode, BudgetTxn } from './budget.entities';
import { ToleranceLadder } from './tolerance-ladder';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const TODAY = new Date().toISOString().slice(0, 10);
const hasDb = await dbAvailable();

/**
 * A budget the company refused grants no room to spend.
 *
 * The ceiling summed `amount_total` over every governed budget regardless of `status`, so a
 * REJECTED proposal kept raising the ceiling of the point governing its node. Observed on the
 * customer database: node `6.111` held an ACTIVE budget of 0 and a REJECTED one of 23,056,000, the
 * point reported 23,056,000 available, and a 23,056,000 document was accepted under a ladder
 * blocking at 100 percent — the ladder working exactly as written, against a ceiling that should
 * have been zero.
 *
 * Reachable through ordinary use: the dimension index refuses only a second LIVE budget at a node,
 * so correcting a wrong amount by cancelling and re-proposing — the only way, since `amount_total`
 * is never overwritten — leaves the refused row behind to inflate the ceiling for good.
 */
describe.skipIf(!hasDb)('a refused budget grants no ceiling (DB-backed)', () => {
  let orm: MikroORM;
  let balance: BudgetBalanceService;
  let coverage: BudgetCoverageService;

  const ids = { company: '', fy: '', dept: '', doc: '' };
  let seq = 0;

  /** A fresh node for each test — `budget` is unique per (fiscal_year, department, node). */
  async function node(): Promise<string> {
    const em = orm.em.fork();
    const n = em.create(BudgetNode, {
      fiscalYear: em.getReference(FiscalYear, ids.fy),
      code: `N-${seq++}`,
      name: 'line',
    });
    await em.persistAndFlush(n);
    return n.id;
  }

  /**
   * A budget at `nodeId`. Several may share one node when their departments differ, which is how
   * a test puts an ACTIVE and a REJECTED row under one control point without tripping the index.
   */
  async function budget(nodeId: string, amountTotal: string, status: string): Promise<string> {
    const em = orm.em.fork();
    const dept = em.create(Department, {
      company: em.getReference(Company, ids.company),
      deptCode: `D-${seq++}`,
      name: 'dept',
      parentDept: em.getReference(Department, ids.dept),
      isActive: true,
    });
    const b = em.create(Budget, {
      fiscalYear: em.getReference(FiscalYear, ids.fy),
      department: dept,
      node: em.getReference(BudgetNode, nodeId),
      amountTotal,
      status,
    });
    await em.persistAndFlush([dept, b]);
    return b.id;
  }

  /** A point at the node, scoped to the department subtree every budget above hangs under. */
  async function controlPoint(nodeId: string): Promise<string> {
    const em = orm.em.fork();
    const cp = em.create(BudgetControlPoint, {
      company: em.getReference(Company, ids.company),
      fiscalYear: em.getReference(FiscalYear, ids.fy),
      budgetNode: em.getReference(BudgetNode, nodeId),
      departmentNode: em.getReference(Department, ids.dept),
      toleranceJson: ToleranceLadder.stringify(ToleranceLadder.BLOCK_AT_CEILING),
      isActive: true,
    });
    await em.persistAndFlush(cp);
    return cp.id;
  }

  async function txn(budgetId: string, type: BudgetTxnType, amount: string): Promise<void> {
    const em = orm.em.fork();
    em.create(BudgetTxn, {
      budget: em.getReference(Budget, budgetId),
      document: em.getReference(Document, ids.doc),
      txnType: type,
      txnDate: TODAY,
      amount,
      createdAt: new Date(),
    });
    await em.flush();
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const dept = em.create(Department, { company, deptCode: 'ROOT', name: 'Root', isActive: true });
    const fy = em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const docType = em.create(DocumentType, { company, code: 'PR', name: 'PR', category: 'PROCUREMENT' as never });
    const template = em.create(FormTemplate, { documentType: docType, version: 1, status: 'PUBLISHED' });
    const workflow = em.create(Workflow, { company, name: 'WF', isActive: true });
    const doc = em.create(Document, {
      docNo: 'PR-A-2026-0001',
      company,
      department: dept,
      documentType: docType,
      formTemplate: template,
      workflow,
      currentStepNo: 0,
      createdBy: user,
      exchangeRate: '1',
      status: 'DRAFT' as never,
      createdAt: new Date(),
    });
    await em.persistAndFlush([company, doc]);

    Object.assign(ids, { company: company.id, fy: fy.id, dept: dept.id, doc: doc.id });
    balance = new BudgetBalanceService(orm.em as EntityManager);
    coverage = new BudgetCoverageService(orm.em as EntityManager);
  });

  it('a REJECTED budget contributes nothing — the customer case, by its own numbers', async () => {
    const n = await node();
    const cp = await controlPoint(n);
    await budget(n, '0', 'ACTIVE');
    await budget(n, '23056000', 'REJECTED');

    const governed = await coverage.budgetsGovernedBy(cp);
    const { ceiling, available } = await balance.balanceAt(governed, null);

    expect(ceiling).toBe('0');
    expect(available).toBe('0');
  });

  it('a DRAFT budget contributes nothing while its plan is unapproved', async () => {
    const n = await node();
    const cp = await controlPoint(n);
    await budget(n, '1000000', 'ACTIVE');
    await budget(n, '500000', 'DRAFT');

    const { ceiling } = await balance.balanceAt(await coverage.budgetsGovernedBy(cp), null);
    expect(ceiling).toBe('1000000');
  });

  it('a CLOSED budget still counts — a closed year records what was appropriated', async () => {
    const n = await node();
    const cp = await controlPoint(n);
    await budget(n, '600000', 'ACTIVE');
    await budget(n, '400000', 'CLOSED');

    const { ceiling } = await balance.balanceAt(await coverage.budgetsGovernedBy(cp), null);
    expect(ceiling).toBe('1000000');
  });

  it('an INACTIVE budget loses its ceiling but keeps its commitments', async () => {
    // The asymmetry, pinned. Nothing wrote a RELEASE, so the 50,000 is still held; dropping the
    // row along with the amount would hand the group back money it is still committed to.
    const n = await node();
    const cp = await controlPoint(n);
    await budget(n, '1000000', 'ACTIVE');
    const paused = await budget(n, '200000', 'INACTIVE');
    await txn(paused, BudgetTxnType.RESERVE, '50000');

    const { ceiling, used, available } = await balance.balanceAt(
      await coverage.budgetsGovernedBy(cp),
      null,
    );
    expect(ceiling).toBe('1000000');
    expect(used).toBe('50000');
    expect(available).toBe('950000');
  });

  it('every derivation of the ceiling agrees on a mixed-status group', async () => {
    // `balanceAt` and `balanceAtMany` are already required never to disagree; `breakdownAt` feeds
    // the control point detail screen and joins them here.
    const n = await node();
    const cp = await controlPoint(n);
    await budget(n, '600000', 'ACTIVE');
    await budget(n, '400000', 'CLOSED');
    await budget(n, '900000', 'REJECTED');
    const governed = await coverage.budgetsGovernedBy(cp);

    const one = await balance.balanceAt(governed, null);
    const many = await balance.balanceAtMany(
      new Map([[cp, { budgetIds: governed, capAmount: null }]]),
    );
    const breakdown = await balance.breakdownAt(governed, null);

    expect(one.ceiling).toBe('1000000');
    expect(many.get(cp)!.ceiling).toBe(one.ceiling);
    expect(many.get(cp)!.available).toBe(one.available);
    expect(breakdown.amountTotal).toBe(one.ceiling);
    expect(breakdown.available).toBe(one.available);
  });

  it('the batched read keeps a non-counted budget’s ledger rows', async () => {
    // `balanceAtMany` used to source its transaction query from the amount map. Once that map
    // holds only counted budgets, reading ids from it would silently drop these rows.
    const n = await node();
    const cp = await controlPoint(n);
    await budget(n, '1000000', 'ACTIVE');
    const paused = await budget(n, '200000', 'INACTIVE');
    await txn(paused, BudgetTxnType.RESERVE, '50000');

    const governed = await coverage.budgetsGovernedBy(cp);
    const many = await balance.balanceAtMany(
      new Map([[cp, { budgetIds: governed, capAmount: null }]]),
    );
    expect(many.get(cp)!.used).toBe('50000');
    expect(many.get(cp)!.available).toBe('950000');
  });

  it('coverage is unchanged — governing is not the same question as counting', async () => {
    const n = await node();
    const cp = await controlPoint(n);
    const active = await budget(n, '0', 'ACTIVE');
    const refused = await budget(n, '23056000', 'REJECTED');

    const governed = await coverage.budgetsGovernedBy(cp);
    // Both still reported, so the detail screen keeps showing what sits under the point — which is
    // how a reader recognises the refused row that used to inflate it.
    expect(new Set(governed)).toEqual(new Set([active, refused]));
  });

  it('a cap_amount is still honoured over the rollup', async () => {
    // The status filter applies to the ROLLUP. An explicit cap replaces it wholesale, and must not
    // be second-guessed by what the governed rows happen to hold.
    const n = await node();
    const em = orm.em.fork();
    const cp = em.create(BudgetControlPoint, {
      company: em.getReference(Company, ids.company),
      fiscalYear: em.getReference(FiscalYear, ids.fy),
      budgetNode: em.getReference(BudgetNode, n),
      departmentNode: em.getReference(Department, ids.dept),
      capAmount: '750000',
      toleranceJson: ToleranceLadder.stringify(ToleranceLadder.BLOCK_AT_CEILING),
      isActive: true,
    });
    await em.persistAndFlush(cp);
    await budget(n, '600000', 'ACTIVE');
    await budget(n, '900000', 'REJECTED');

    const { ceiling } = await balance.balanceAt(await coverage.budgetsGovernedBy(cp.id), '750000');
    expect(ceiling).toBe('750000');
  });
});
