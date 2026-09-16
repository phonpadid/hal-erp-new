import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ScopeService } from '../rbac/scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { Currency } from '../currency/currency.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetCoverageService } from './budget-coverage.service';
import { BudgetNodeService } from './budget-node.service';
import { BudgetService } from './budget.service';
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
 * Moving a budget to the department that now owns its work.
 *
 * Not a transfer of money and not a typo fix: the plan code, the year and the amount are all
 * right, and the organisation reorganised underneath them. The node cannot carry this — a plan
 * node holds no department by design — so it is the budget's own `department_id` that has to move.
 *
 * What makes it more than a column write is coverage. A control point governs a budget when its
 * `department_node_id` is that budget's department or an ancestor of it, so a move lands the
 * budget outside every point that governed it. An uncovered budget raises NO error when it is
 * spent against — it simply stops being checked — so these tests are mostly about what the move
 * leaves standing, not about the column.
 */
describe.skipIf(!hasDb)('moving a budget between departments (DB-backed)', () => {
  let orm: MikroORM;
  let budgets: BudgetService;
  let nodes: BudgetNodeService;
  let coverage: BudgetCoverageService;

  const ids = { companyA: '', companyB: '', admin: '', vehicles: '', deptB: '', fyA: '' };
  let seq = 0;
  const uniq = (prefix: string) => `${prefix}-${seq++}`;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const companyB = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true });
    // Two sibling departments of one company, and one belonging to another company entirely.
    const admin = em.create(Department, { company: companyA, deptCode: 'ADM', name: 'Administration', isActive: true });
    const vehicles = em.create(Department, { company: companyA, deptCode: 'VEH', name: 'Vehicles', isActive: true });
    const deptB = em.create(Department, { company: companyB, deptCode: 'DB', name: 'Someone else', isActive: true });
    const y = new Date().getUTCFullYear();
    const fyA = em.create(FiscalYear, { company: companyA, year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'OPEN' });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    await em.flush();

    GLOBAL.userId = user.id;
    Object.assign(ids, {
      companyA: companyA.id, companyB: companyB.id,
      admin: admin.id, vehicles: vehicles.id, deptB: deptB.id,
      fyA: fyA.id,
    });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    const scope = new ScopeService();
    coverage = new BudgetCoverageService(orm.em);
    budgets = new BudgetService(
      orm.em,
      new AccountService(orm.em, scope),
      new BudgetBalanceService(orm.em),
      coverage,
      scope,
    );
    nodes = new BudgetNodeService(orm.em, new CompanyScopeService(orm.em));
  });

  const makeNode = (code: string) =>
    asCtx(ids.companyA, () => nodes.create({ fiscalYearId: ids.fyA, code: uniq(code) }));

  const makeBudget = async (nodeId: string, departmentId: string, status = 'ACTIVE') => {
    const em = orm.em.fork();
    const b = em.create(Budget, {
      fiscalYear: em.getReference(FiscalYear, ids.fyA),
      department: em.getReference(Department, departmentId),
      node: em.getReference(BudgetNode, nodeId),
      amountTotal: '1000000',
      status,
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

  const pointsGoverning = async (budgetId: string) => {
    const fresh = new BudgetCoverageService(orm.em);
    const map = await fresh.resolveControlPoints([budgetId]);
    return map.get(budgetId) ?? [];
  };

  const departmentOf = async (budgetId: string) => {
    const em = orm.em.fork();
    const b = await em.findOne(Budget, { id: budgetId }, { ...FILTER_OFF, populate: ['department'] });
    return b!.department.id;
  };

  it('moves the budget to the new department', async () => {
    const node = await makeNode('1.101');
    const id = await makeBudget(node.id, ids.admin);
    await makeControlPoint(node.id, ids.admin);

    await asCtx(ids.companyA, () => budgets.update(id, { departmentId: ids.vehicles }));

    expect(await departmentOf(id)).toBe(ids.vehicles);
  });

  it('leaves the budget governed, by minting the point the move would otherwise strand it without', async () => {
    // The heart of it. Every control point on the customer's data sits on a department with no
    // children, so the old point does NOT reach the new department and the budget arrives
    // ungoverned — which is not an error at spend time, it is simply no longer checked.
    const node = await makeNode('1.102');
    const id = await makeBudget(node.id, ids.admin);
    const old = await makeControlPoint(node.id, ids.admin);

    await asCtx(ids.companyA, () => budgets.update(id, { departmentId: ids.vehicles }));

    const governing = await pointsGoverning(id);
    expect(governing.length).toBeGreaterThan(0);
    expect(governing.map((cp) => cp.id)).not.toContain(old);
    expect(governing[0].departmentNodeId).toBe(ids.vehicles);
    expect(governing[0].budgetNodeId).toBe(node.id);
  });

  it('mints the written-down ladder, never the one the budget left behind', async () => {
    // A ladder carried over from the old point could be WARN-only, and a control point that warns
    // where everyone assumed it blocks is invisible until something has already been overspent.
    // Plan activation makes the same choice for the same reason.
    const node = await makeNode('1.103');
    const id = await makeBudget(node.id, ids.admin);
    const em = orm.em.fork();
    const lenient = em.create(BudgetControlPoint, {
      company: em.getReference(Company, ids.companyA),
      fiscalYear: em.getReference(FiscalYear, ids.fyA),
      budgetNode: em.getReference(BudgetNode, node.id),
      departmentNode: em.getReference(Department, ids.admin),
      capAmount: undefined,
      toleranceJson: JSON.stringify([{ at: 500, action: 'WARN' }]),
      isActive: true,
    });
    await em.persistAndFlush(lenient);

    await asCtx(ids.companyA, () => budgets.update(id, { departmentId: ids.vehicles }));

    const [minted] = await pointsGoverning(id);
    expect(JSON.parse(minted.toleranceJson)).toEqual([{ at: 100, action: 'BLOCK' }]);
  });

  it('mints nothing when a point already reaches the new department', async () => {
    // Re-governing is owed only where coverage is actually missing. Minting anyway would put a
    // second ceiling on the budget that nobody asked for.
    const node = await makeNode('1.104');
    const id = await makeBudget(node.id, ids.admin);
    await makeControlPoint(node.id, ids.admin);
    const reaching = await makeControlPoint(node.id, ids.vehicles);

    await asCtx(ids.companyA, () => budgets.update(id, { departmentId: ids.vehicles }));

    const governing = await pointsGoverning(id);
    expect(governing.map((cp) => cp.id)).toEqual([reaching]);
  });

  it('mints nothing for a budget that is not ACTIVE', async () => {
    // Coverage is owed to spendable money. A DRAFT is a proposal; activating the plan that carries
    // it is what covers it, and minting here would decide that budget's ladder in advance.
    const node = await makeNode('1.105');
    const id = await makeBudget(node.id, ids.admin, 'DRAFT');

    await asCtx(ids.companyA, () => budgets.update(id, { departmentId: ids.vehicles }));

    expect(await departmentOf(id)).toBe(ids.vehicles);
    expect(await pointsGoverning(id)).toHaveLength(0);
  });

  it('re-saving the same department is not a move and mints nothing', async () => {
    const node = await makeNode('1.106');
    const id = await makeBudget(node.id, ids.admin);
    const only = await makeControlPoint(node.id, ids.admin);

    await asCtx(ids.companyA, () =>
      budgets.update(id, { departmentId: ids.admin, budgetName: 'renamed' }),
    );

    expect((await pointsGoverning(id)).map((cp) => cp.id)).toEqual([only]);
  });

  it('refuses a department belonging to another company', async () => {
    // Invariant 1. Nothing about a budget id says whose department may be named against it.
    const node = await makeNode('1.107');
    const id = await makeBudget(node.id, ids.admin);
    await makeControlPoint(node.id, ids.admin);

    await expect(
      asCtx(ids.companyA, () => budgets.update(id, { departmentId: ids.deptB })),
    ).rejects.toThrow(/does not exist in the active company/i);
    expect(await departmentOf(id)).toBe(ids.admin);
  });

  it('refuses a move onto a plan code the destination already funds', async () => {
    // `(node_id, department_id)` is unique unless REJECTED. Said in words here, because the
    // database's own message names an index and not the collision the reader has to resolve.
    const node = await makeNode('1.108');
    const moving = await makeBudget(node.id, ids.admin);
    await makeBudget(node.id, ids.vehicles);

    await expect(
      asCtx(ids.companyA, () => budgets.update(moving, { departmentId: ids.vehicles })),
    ).rejects.toThrow(/already has a budget at plan code/i);
    expect(await departmentOf(moving)).toBe(ids.admin);
  });

  it('keeps the spending history attached to the budget, which is what moves', async () => {
    // The ledger hangs off `budget_id`, so nothing about it is rewritten by the move — the money
    // and its history travel together to the new department. Pinned because the alternative
    // people assume is that a move re-books past spending, which it does not.
    const node = await makeNode('1.109');
    const id = await makeBudget(node.id, ids.admin);
    await makeControlPoint(node.id, ids.admin);

    await asCtx(ids.companyA, () => budgets.update(id, { departmentId: ids.vehicles }));

    const em = orm.em.fork();
    const after = await em.findOne(Budget, { id }, FILTER_OFF);
    expect(after!.amountTotal).toBe('1000000.00');
    expect(after!.node.id).toBe(node.id);
  });
});
