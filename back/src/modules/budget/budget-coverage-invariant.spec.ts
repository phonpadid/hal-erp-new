import { BadRequestException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { Account } from '../accounting/accounting.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetControlPointService } from './budget-control-point.service';
import { BudgetCoverageService } from './budget-coverage.service';
import { BudgetPlanService, PLAN_POST_ACTION } from './budget-plan.service';
import { BudgetService } from './budget.service';
import { Budget, BudgetMovement, BudgetNode } from './budget.entities';
import { ToleranceLadder } from './tolerance-ladder';
import { DeptDocTypeService } from '../document/dept-doc-type.service';
import { NumberingService } from '../document/numbering.service';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Workflow } from '../approval/approval.entities';
import { AppUser } from '../rbac/rbac.entities';
import { DocStatus } from '../../common/enums';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;
const hasDb = await dbAvailable();

/**
 * The coverage invariant (design.md D3): every ACTIVE budget must be governed by at least one
 * active control point.
 *
 * This is the enforcement whose absence is invisible. An uncovered budget raises no error when
 * it is spent against — it simply stops being checked — so one careless configuration edit could
 * disable budget control across a company with nothing in the logs to show for it.
 */
describe.skipIf(!hasDb)('budget coverage invariant (DB-backed)', () => {
  let orm: MikroORM;
  let budgets: BudgetService;
  let controlPoints: BudgetControlPointService;
  let coverage: BudgetCoverageService;
  let plans: BudgetPlanService;

  const ids = { company: '', dept: '', deptChild: '', fy: '', planType: '', user: '', workflow: '' };
  let seq = 0;

  function asCtx<T>(fn: () => Promise<T>, companyId = ids.company): Promise<T> {
    return RequestContext.run({ companyId, departmentId: ids.dept, grants: [] }, fn);
  }

  /**
   * A node in the plan. Control points sit on these now, not on accounts — the `account` helper
   * below stays because a budget may still record a GL, but nothing about coverage reads it.
   */
  async function node(code: string, parent?: BudgetNode) {
    const em = orm.em.fork();
    const n = em.create(BudgetNode, {
      fiscalYear: em.getReference(FiscalYear, ids.fy),
      code,
      name: code,
      parent: parent ? em.getReference(BudgetNode, parent.id) : undefined,
    });
    await em.persistAndFlush(n);
    return n;
  }

  async function account(code: string, opts: { postable?: boolean } = {}) {
    const em = orm.em.fork();
    const a = em.create(Account, {
      company: em.getReference(Company, ids.company),
      code,
      name: code,
      accountType: 'EXPENSE' as never,
      isPostable: opts.postable ?? true,
      isActive: true,
    });
    await em.persistAndFlush(a);
    return a;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const dept = em.create(Department, { company, deptCode: 'D', name: 'D', isActive: true });
    const deptChild = em.create(Department, { company, deptCode: 'DC', name: 'DC', parentDept: dept, isActive: true });
    const fy = em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const workflow = em.create(Workflow, { company, name: 'WF', isActive: true });
    const planType = em.create(DocumentType, {
      company, code: 'PLAN', name: 'PLAN', category: 'FINANCE' as never,
      requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false,
      isActive: true, postAction: PLAN_POST_ACTION,
    });
    em.create(FormTemplate, { documentType: planType, version: 1, status: 'PUBLISHED' });
    await em.persistAndFlush(company);
    Object.assign(ids, {
      company: company.id, dept: dept.id, deptChild: deptChild.id, fy: fy.id,
      planType: planType.id, user: user.id, workflow: workflow.id,
    });

    const scope = new CompanyScopeService(orm.em as EntityManager);
    const accounts = new AccountService(orm.em as EntityManager, scope);
    const balance = new BudgetBalanceService(orm.em as EntityManager);
    coverage = new BudgetCoverageService(orm.em as EntityManager);
    budgets = new BudgetService(orm.em as EntityManager, accounts, balance);
    controlPoints = new BudgetControlPointService(orm.em as EntityManager, coverage, balance);
    plans = new BudgetPlanService(
      orm.em as EntityManager,
      new DeptDocTypeService(orm.em as EntityManager),
      new NumberingService(orm.em as EntityManager),
      coverage,
      budgets,
    );
  });

  /**
   * Put budgets in force through the production activation routine.
   *
   * The document and its movements are built directly rather than through plan intake: intake
   * needs a routing mapping, a workflow and a number, none of which this spec is about. What
   * matters here is that coverage is established by `BudgetPlanService.activate` — the same code
   * an approval runs — and not by anything this helper does itself.
   */
  async function activate(budgetIds: string[]): Promise<void> {
    const em = orm.em.fork();
    const document = em.create(Document, {
      docNo: `PLAN-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.planType),
      formTemplate: await em.findOneOrFail(FormTemplate, { documentType: ids.planType }, FILTER_OFF),
      workflow: em.getReference(Workflow, ids.workflow),
      currentStepNo: 0,
      createdBy: em.getReference(AppUser, ids.user),
      exchangeRate: '1',
      totalAmount: '0',
      status: DocStatus.APPROVED,
      createdAt: new Date(),
    });
    for (const budgetId of budgetIds) {
      em.create(BudgetMovement, {
        company: em.getReference(Company, ids.company),
        document,
        movementType: PLAN_POST_ACTION,
        toBudget: em.getReference(Budget, budgetId),
        amount: '0',
        createdAt: new Date(),
      });
    }
    await em.persistAndFlush(document);
    await em.transactional((tem) => plans.activate(document, tem as EntityManager));
  }

  /** Propose a budget, then put it in force the way an approved plan does. */
  async function proposeAndActivate(
    code: string,
    departmentId = ids.deptChild,
    at?: BudgetNode,
  ): Promise<Budget> {
    const n = at ?? (await node(code));
    const budget = await asCtx(() =>
      budgets.create({
        fiscalYearId: ids.fy,
        departmentId,
        nodeId: n.id,
        glAccount: code,
        amountTotal: '100000',
      } as never),
    );
    await activate([budget.id]);
    return budget;
  }

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  describe('creating a budget', () => {
    it('produces a DRAFT budget governed by nothing', async () => {
      // Creation used to mint a control point. It no longer does: setting a ceiling is what a
      // budget plan asks approval for, and minting one here would let whoever proposed a budget
      // decide the ladder for every budget that later falls under the same node.
      const code = `5${seq++}00`;
      await account(code);
      const nd = await node(code);
      const budget = await asCtx(() =>
        budgets.create({
          fiscalYearId: ids.fy,
          departmentId: ids.deptChild,
          nodeId: nd.id,
          glAccount: code,
          amountTotal: '100000',
        } as never),
      );
      expect(budget.status).toBe('DRAFT');
      expect(await coverage.controlPointsFor(budget.id)).toHaveLength(0);
    });

    it('owes a DRAFT budget no coverage', async () => {
      // The invariant is owed to ACTIVE budgets. A DRAFT one cannot be spent against, so there is
      // nothing to check and no ceiling it could exceed — it is outside the invariant, not a
      // violation of it.
      const em = orm.em.fork();
      const drafts = await em.find(Budget, { status: 'DRAFT' }, FILTER_OFF);
      expect(drafts.length).toBeGreaterThan(0);
      for (const b of drafts) {
        expect(await coverage.controlPointsFor(b.id)).toHaveLength(0);
      }
    });

    it('leaves no ACTIVE budget uncovered, whichever path created it', async () => {
      const em = orm.em.fork();
      const all = await em.find(Budget, { status: 'ACTIVE' }, FILTER_OFF);
      for (const b of all) {
        expect((await coverage.controlPointsFor(b.id)).length).toBeGreaterThan(0);
      }
    });
  });

  describe('activating a budget', () => {
    it('creates a self-scoped control point when nothing governs it yet', async () => {
      const code = `5${seq++}00`;
      await account(code);
      const budget = await proposeAndActivate(code);
      const governing = await coverage.controlPointsFor(budget.id);
      expect(governing).toHaveLength(1);
      expect(governing[0].departmentNodeId).toBe(ids.deptChild);
    });

    it('adds no control point when an existing one already governs the budget', async () => {
      const code = `5${seq++}00`;
      const acc = await account(code);
      const nd = await node(`N-${seq++}`);
      // A department-level point that already covers everything under `dept`.
      await asCtx(() =>
        controlPoints.create({
          fiscalYearId: ids.fy,
          budgetNodeId: nd.id,
          departmentNodeId: ids.dept,
          tolerance: [{ at: 100, action: 'BLOCK' }],
        }),
      );
      const budget = await proposeAndActivate(code, ids.deptChild, nd);
      const governing = await coverage.controlPointsFor(budget.id);
      expect(governing).toHaveLength(1);
      // The pre-existing wider point, not a freshly minted self-scoped one.
      expect(governing[0].departmentNodeId).toBe(ids.dept);
    });

    it('blocks at the ceiling — the plan authors no ladder', async () => {
      // Written down rather than inferred: a control point that warns where everyone assumed it
      // blocks is invisible until something is overspent. A plan cannot say otherwise, because the
      // control point it would configure does not exist while the plan is being written.
      const code = `5${seq++}00`;
      await account(code);
      const budget = await proposeAndActivate(code);
      const governing = await coverage.controlPointsFor(budget.id);
      expect(ToleranceLadder.parseJson(governing[0].toleranceJson)).toEqual([
        { at: 100, action: 'BLOCK' },
      ]);
    });

    it('leaves an existing point’s ladder alone', async () => {
      const code = `5${seq++}00`;
      const acc = await account(code);
      const nd = await node(`N-${seq++}`);
      await asCtx(() =>
        controlPoints.create({
          fiscalYearId: ids.fy,
          budgetNodeId: nd.id,
          departmentNodeId: ids.dept,
          tolerance: [{ at: 90, action: 'WARN' }],
        }),
      );
      const budget = await proposeAndActivate(code, ids.deptChild, nd);
      const governing = await coverage.controlPointsFor(budget.id);
      expect(governing).toHaveLength(1);
      expect(ToleranceLadder.parseJson(governing[0].toleranceJson)).toEqual([
        { at: 90, action: 'WARN' },
      ]);
    });
  });

  describe('deactivating a control point', () => {
    it('is refused when it is the last one covering an ACTIVE budget', async () => {
      const code = `5${seq++}00`;
      await account(code);
      const budget = await proposeAndActivate(code);
      const only = (await coverage.controlPointsFor(budget.id))[0];
      await expect(asCtx(() => controlPoints.deactivate(only.id))).rejects.toThrow(
        BadRequestException,
      );
      // ...and it is still active, so the budget is still checked.
      expect((await coverage.controlPointsFor(budget.id)).map((c) => c.id)).toContain(only.id);
    });

    it('is allowed when another control point still covers the budget', async () => {
      const code = `5${seq++}00`;
      const acc = await account(code);
      const nd = await node(`N-${seq++}`);
      const budget = await proposeAndActivate(code, ids.deptChild, nd);
      const selfScoped = (await coverage.controlPointsFor(budget.id))[0];
      await asCtx(() =>
        controlPoints.create({
          fiscalYearId: ids.fy,
          budgetNodeId: nd.id,
          departmentNodeId: ids.dept,
          tolerance: [{ at: 100, action: 'BLOCK' }],
        }),
      );
      await expect(asCtx(() => controlPoints.deactivate(selfScoped.id))).resolves.toBeDefined();
      const left = await coverage.controlPointsFor(budget.id);
      expect(left).toHaveLength(1);
      expect(left[0].id).not.toBe(selfScoped.id);
    });

    it('is allowed when everything it covers is still DRAFT', async () => {
      // Coverage is owed to ACTIVE budgets only, so a point covering nothing spendable is not the
      // last thing standing between anyone and an unchecked budget.
      const code = `5${seq++}00`;
      const acc = await account(code);
      const nd = await node(`N-${seq++}`);
      const cp = await asCtx(() =>
        controlPoints.create({
          fiscalYearId: ids.fy,
          budgetNodeId: nd.id,
          departmentNodeId: ids.deptChild,
          tolerance: [{ at: 100, action: 'BLOCK' }],
        }),
      );
      await asCtx(() =>
        budgets.create({
          fiscalYearId: ids.fy,
          departmentId: ids.deptChild,
          nodeId: nd.id,
          glAccount: code,
          amountTotal: '100000',
        } as never),
      );
      await expect(asCtx(() => controlPoints.deactivate(cp.id))).resolves.toBeDefined();
    });
  });

  describe('control point administration', () => {
    it('rejects a non-null cap_amount', async () => {
      const acc = await account(`5${seq++}00`);
      const nd = await node(`N-${seq++}`);
      await expect(
        asCtx(() =>
          controlPoints.create({
            fiscalYearId: ids.fy,
            budgetNodeId: nd.id,
            departmentNodeId: ids.dept,
            tolerance: [{ at: 100, action: 'BLOCK' }],
            capAmount: '1000' as never,
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an empty tolerance ladder', async () => {
      const acc = await account(`5${seq++}00`);
      const nd = await node(`N-${seq++}`);
      await expect(
        asCtx(() =>
          controlPoints.create({
            fiscalYearId: ids.fy,
            budgetNodeId: nd.id,
            departmentNodeId: ids.dept,
            tolerance: [],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a node belonging to another company', async () => {
      const em = orm.em.fork();
      const other = em.create(Company, { code: 'Z', nameTh: 'Z', taxId: '9', branchCode: '00000', isActive: true });
      // A node in the other company's own fiscal year. Company scoping on a node runs through its
      // fiscal year — `budget_node` carries no company column of its own.
      const otherFy = em.create(FiscalYear, {
        company: other, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN',
      });
      const otherNd = em.create(BudgetNode, { fiscalYear: otherFy, code: 'Z1', name: 'Z1' });
      await em.persistAndFlush(other);
      await expect(
        asCtx(() =>
          controlPoints.create({
            fiscalYearId: ids.fy,
            budgetNodeId: otherNd.id,
            departmentNodeId: ids.dept,
            tolerance: [{ at: 100, action: 'BLOCK' }],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('lists only the active company’s control points', async () => {
      const listed = await asCtx(() => controlPoints.list());
      expect(listed.length).toBeGreaterThan(0);
      const em = orm.em.fork();
      const { BudgetControlPoint } = await import('./budget.entities');
      for (const view of listed) {
        const row = await em.findOneOrFail(BudgetControlPoint, { id: view.id }, {
          ...FILTER_OFF,
          populate: ['company'],
        });
        expect(row.company.id).toBe(ids.company);
      }
    });
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[budget-coverage-invariant] no database reachable — skipping DB-backed spec');
}
