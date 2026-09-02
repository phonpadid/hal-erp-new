import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ControlPolicy } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetCoverageService } from './budget-coverage.service';
import { BudgetNodeService } from './budget-node.service';
import { Budget, BudgetControlPoint, BudgetNode } from './budget.entities';
import { ToleranceLadder } from './tolerance-ladder';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

function asCtx<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId: GLOBAL.userId, companyId, grants: [] }, fn);
}
const GLOBAL = { userId: '' };

/**
 * The plan's structure, and the fact that it is NOT the chart of accounts.
 *
 * A node is a place in the plan — department, category or line. It carries no amount, no status and
 * no approval: the money at a node is a `budget`. These tests hold the two properties that make the
 * separation worth having — several budgets may share one account, and a category may hold nothing
 * at all while the plan is still being written.
 */
describe.skipIf(!hasDb)('budget nodes (DB-backed)', () => {
  let orm: MikroORM;
  let nodes: BudgetNodeService;
  let coverage: BudgetCoverageService;
  let balance: BudgetBalanceService;

  const ids = { companyA: '', companyB: '', deptA: '', deptB: '', fyA: '', fyA2: '', fyB: '' };
  let seq = 0;
  const uniq = (prefix: string) => `${prefix}-${seq++}`;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const companyB = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'DA', isActive: true });
    const deptB = em.create(Department, { company: companyB, deptCode: 'DB', name: 'DB', isActive: true });
    const y = new Date().getUTCFullYear();
    const fyA = em.create(FiscalYear, { company: companyA, year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'OPEN' });
    const fyA2 = em.create(FiscalYear, { company: companyA, year: y + 1, startDate: `${y + 1}-01-01`, endDate: `${y + 1}-12-31`, status: 'OPEN' });
    const fyB = em.create(FiscalYear, { company: companyB, year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'OPEN' });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    await em.flush();

    GLOBAL.userId = user.id;
    Object.assign(ids, {
      companyA: companyA.id, companyB: companyB.id,
      deptA: deptA.id, deptB: deptB.id,
      fyA: fyA.id, fyA2: fyA2.id, fyB: fyB.id,
    });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    nodes = new BudgetNodeService(orm.em, new CompanyScopeService(orm.em));
    coverage = new BudgetCoverageService(orm.em);
    balance = new BudgetBalanceService(orm.em);
  });

  const makeBudget = async (nodeId: string, departmentId: string, amountTotal: string, glAccount?: string) => {
    const em = orm.em.fork();
    const b = em.create(Budget, {
      fiscalYear: em.getReference(FiscalYear, ids.fyA),
      department: em.getReference(Department, departmentId),
      node: em.getReference(BudgetNode, nodeId),
      glAccount,
      amountTotal,
      controlPolicy: ControlPolicy.HARD_STOP,
      status: 'ACTIVE',
    });
    await em.persistAndFlush(b);
    return b.id;
  };

  const makeControlPoint = async (budgetNodeId: string, departmentNodeId: string) => {
    const em = orm.em.fork();
    const cp = em.create(BudgetControlPoint, {
      company: em.getReference(Company, ids.companyA),
      fiscalYear: em.getReference(FiscalYear, ids.fyA),
      budgetNode: em.getReference(BudgetNode, budgetNodeId),
      departmentNode: em.getReference(Department, departmentNodeId),
      capAmount: undefined,
      toleranceJson: ToleranceLadder.stringify(ToleranceLadder.BLOCK_AT_CEILING),
      isActive: true,
    });
    await em.persistAndFlush(cp);
    return cp.id;
  };

  // ---- 5.1 the shape the old key forbade -------------------------------------------------

  it('lets two budgets in one fiscal year and department share one gl_account', async () => {
    // The customer's own books: fuel, repairs and registration all post to account 658.0007 inside
    // one department. Under `(fiscal_year, department, gl_account)` the second of these could not
    // be saved at all — and the second is the one this system exists to plan.
    const fuel = await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code: uniq('1.101'), name: 'Fuel' }));
    const repairs = await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code: uniq('1.102'), name: 'Repairs' }));

    const a = await makeBudget(fuel.id, ids.deptA, '500000', '658.0007');
    const b = await makeBudget(repairs.id, ids.deptA, '300000', '658.0007');

    const em = orm.em.fork();
    const both = await em.find(Budget, { id: { $in: [a, b] } }, FILTER_OFF);
    expect(both).toHaveLength(2);
    expect(new Set(both.map((x) => x.glAccount))).toEqual(new Set(['658.0007']));
  });

  it('still refuses two budgets at the same node in the same department', async () => {
    // The uniqueness did not disappear, it moved: the node is the identity now.
    const node = await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code: uniq('1.103') }));
    await makeBudget(node.id, ids.deptA, '100');
    await expect(makeBudget(node.id, ids.deptA, '200')).rejects.toThrow();
  });

  // ---- 5.2 node rules ---------------------------------------------------------------------

  it('refuses a duplicate code within one fiscal year, naming the code', async () => {
    const code = uniq('1.200');
    await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code }));
    await expect(
      asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code })),
    ).rejects.toThrow(new RegExp(code));
  });

  it('accepts the same code again in the next fiscal year', async () => {
    // A plan is rewritten each year and keeps its numbering; `1.101` next year is a different node
    // holding different money, which is exactly why the year is part of the key.
    const code = uniq('1.201');
    await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code }));
    const next = await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA2, code }));
    expect(next.fiscalYearId).toBe(ids.fyA2);
  });

  it('refuses a parent from another fiscal year', async () => {
    const parent = await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA2, code: uniq('1') }));
    await expect(
      asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code: uniq('1.1'), parentId: parent.id })),
    ).rejects.toThrow(/same fiscal year/i);
  });

  it('refuses a fiscal year belonging to another company', async () => {
    await expect(
      asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyB, code: uniq('9') })),
    ).rejects.toThrow(/does not exist in the active company/i);
  });

  it('refuses a cycle, walking the chain rather than reading the code', async () => {
    // The code cannot be parsed for depth: in this organisation's plan `1.1` is a category and
    // `1.101` a line beneath it, and both carry exactly one dot.
    const top = await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code: uniq('1') }));
    const mid = await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code: uniq('1.1'), parentId: top.id }));
    const leaf = await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code: uniq('1.101'), parentId: mid.id }));

    await expect(
      asCtx(ids.companyA, () => nodes.update(top.id, { parentId: leaf.id })),
    ).rejects.toThrow(/beneath itself/i);
  });

  it('re-parents a node when the move is legitimate', async () => {
    const a = await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code: uniq('2') }));
    const b = await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code: uniq('3') }));
    const child = await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code: uniq('2.1'), parentId: a.id }));

    const moved = await asCtx(ids.companyA, () => nodes.update(child.id, { parentId: b.id }));
    expect(moved.parentId).toBe(b.id);
  });

  // ---- 5.3 an empty category is a plan being written, not a fault -------------------------

  it('accepts a node with no budget beneath it, and reports it as empty', async () => {
    const cat = await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code: uniq('4'), name: 'Vehicles' }));
    const listed = (await asCtx(ids.companyA, () => nodes.list(ids.fyA))).find((n) => n.id === cat.id);
    expect(listed).toBeDefined();
    expect(listed!.budgetCount).toBe(0);
    expect(listed!.childCount).toBe(0);
  });

  it('counts budgets and children so a screen can tell a category from a line', async () => {
    const cat = await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code: uniq('5'), name: 'Vehicles' }));
    const line = await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code: uniq('5.1'), parentId: cat.id }));
    await makeBudget(line.id, ids.deptA, '1000');

    const listed = await asCtx(ids.companyA, () => nodes.list(ids.fyA));
    const byId = new Map(listed.map((n) => [n.id, n]));
    expect(byId.get(cat.id)).toMatchObject({ childCount: 1, budgetCount: 0 });
    expect(byId.get(line.id)).toMatchObject({ childCount: 0, budgetCount: 1 });
  });

  // ---- 5.6 the one thing an empty category must not become --------------------------------

  it('reports a ZERO ceiling for a point over an empty category, never an unlimited one', async () => {
    const cat = await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code: uniq('6') }));
    const cpId = await makeControlPoint(cat.id, ids.deptA);

    const governed = await coverage.budgetsGovernedBy(cpId);
    expect(governed).toEqual([]);
    expect(await balance.balanceAt(governed, null)).toEqual({ ceiling: '0', used: '0', available: '0' });
  });

  it('starts limiting as soon as the category is filled', async () => {
    // The pair to the test above: zero is not a permanent verdict on a category, it is the ceiling
    // of what has been planned so far.
    const cat = await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code: uniq('7') }));
    const cpId = await makeControlPoint(cat.id, ids.deptA);
    const line = await asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code: uniq('7.1'), parentId: cat.id }));
    await makeBudget(line.id, ids.deptA, '250000');

    const governed = await coverage.budgetsGovernedBy(cpId);
    expect(governed).toHaveLength(1);
    expect((await balance.balanceAt(governed, null)).ceiling).toBe('250000');
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[budget-node] no database reachable — skipping DB-backed spec');
}
