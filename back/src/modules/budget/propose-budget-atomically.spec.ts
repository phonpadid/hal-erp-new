import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { Workflow } from '../approval/approval.entities';
import { DeptDocTypeService } from '../document/dept-doc-type.service';
import { NumberingService } from '../document/numbering.service';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetCoverageService } from './budget-coverage.service';
import { BudgetPlanService, PLAN_POST_ACTION } from './budget-plan.service';
import { BudgetService } from './budget.service';
import { Budget, BudgetMovement, BudgetNode } from './budget.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;
const hasDb = await dbAvailable();

/**
 * Proposing a budget is ONE act to the user and used to be TWO commits to the server.
 *
 * `POST /budgets` inserted a `DRAFT` budget; `POST /budgets/plans` raised the plan that would
 * activate it. Nothing bound them, so a failure in the second left a budget nothing could reach:
 * the dimension index `budget_dimension_unique_unless_rejected` refuses a second proposal for the
 * same line, a budget has no delete (they are financial records), `REJECTED` is the one status
 * that frees the dimension and the edit form does not offer it, and `createPlan` had exactly one
 * caller. Money that exists, cannot be spent, and cannot be got rid of.
 *
 * It happened on the customer's database: no `ACTIVATE_BUDGET` type was configured yet, the plan
 * call answered 400, and budget `1.106` sat unreachable until it was worked around by hand.
 */
describe.skipIf(!hasDb)('proposing a budget is one unit of work (DB-backed)', () => {
  let orm: MikroORM;
  let plans: BudgetPlanService;
  let budgets: BudgetService;
  const ids = {
    company: '', other: '', user: '',
    root: '', child: '', otherDept: '',
    fyOpen: '', fyOther: '', planType: '',
  };
  let seq = 0;

  const asCtx = <T>(fn: () => Promise<T>, companyId = ids.company): Promise<T> =>
    RequestContext.run({ companyId, departmentId: ids.root, userId: ids.user, grants: [] }, fn);

  /** A node of its own per test, so no two tests share a dimension by accident. */
  async function node(fiscalYearId = ids.fyOpen): Promise<string> {
    const em = orm.em.fork();
    const n = em.create(BudgetNode, {
      fiscalYear: em.getReference(FiscalYear, fiscalYearId),
      code: `1.${seq++}`,
      name: `Line ${seq}`,
    });
    await em.persistAndFlush(n);
    return n.id;
  }

  const proposal = (nodeId: string, over: Record<string, unknown> = {}) => ({
    fiscalYearId: ids.fyOpen,
    departmentId: ids.child,
    nodeId,
    amountTotal: '12000000',
    budgetName: 'Support and subsidies',
    ...over,
  });

  const countBudgets = () => orm.em.fork().count(Budget, {}, FILTER_OFF);
  const countDocs = () => orm.em.fork().count(Document, {}, FILTER_OFF);
  const countMovements = () => orm.em.fork().count(BudgetMovement, {}, FILTER_OFF);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();

    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const other = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true });
    const root = em.create(Department, { company, deptCode: 'ROOT', name: 'ROOT', isActive: true });
    const child = em.create(Department, { company, deptCode: 'CHILD', name: 'CHILD', parentDept: root, isActive: true });
    const otherDept = em.create(Department, { company: other, deptCode: 'BD', name: 'BD', isActive: true });
    const fyOpen = em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const fyOther = em.create(FiscalYear, { company: other, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const workflow = em.create(Workflow, { company, name: 'WF', isActive: true });

    // Resolved by post_action, never by code (invariant 7) — hence the deliberately odd code.
    const planType = em.create(DocumentType, {
      company, code: 'PLAN_X', name: 'Budget plan', category: 'FINANCE',
      requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false,
      isActive: true, postAction: PLAN_POST_ACTION,
    } as never);
    const template = em.create(FormTemplate, { documentType: planType, version: 1, status: 'PUBLISHED' });
    // Enabled for BOTH departments, so a plan routed through either is routable.
    em.create(DeptDocType, { department: root, documentType: planType, formTemplate: template, workflow, isActive: true });
    em.create(DeptDocType, { department: child, documentType: planType, formTemplate: template, workflow, isActive: true });

    await em.persistAndFlush(company);
    Object.assign(ids, {
      company: company.id, other: other.id, user: user.id,
      root: root.id, child: child.id, otherDept: otherDept.id,
      fyOpen: fyOpen.id, fyOther: fyOther.id, planType: planType.id,
    });

    const m = orm.em;
    const scope = new CompanyScopeService(m);
    budgets = new BudgetService(m, new AccountService(m, scope), new BudgetBalanceService(m));
    plans = new BudgetPlanService(
      m,
      new DeptDocTypeService(m),
      new NumberingService(m),
      new BudgetCoverageService(m),
      budgets,
    );
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  describe('proposing', () => {
    it('writes the budget, the plan document and the movement together', async () => {
      const n = await node();
      const { budgetId, documentId } = await asCtx(() => plans.propose(proposal(n)));

      const em = orm.em.fork();
      const budget = await em.findOneOrFail(Budget, { id: budgetId }, FILTER_OFF);
      const document = await em.findOneOrFail(Document, { id: documentId }, { ...FILTER_OFF, populate: ['documentType'] });
      const movement = await em.findOneOrFail(BudgetMovement, { document: documentId }, { ...FILTER_OFF, populate: ['toBudget'] });

      // DRAFT, not spendable: approving the plan is what puts it in force.
      expect(budget.status).toBe('DRAFT');
      expect(document.documentType.postAction).toBe(PLAN_POST_ACTION);
      expect(movement.movementType).toBe(PLAN_POST_ACTION);
      expect(movement.toBudget!.id).toBe(budgetId);
      // The figure travels as a DECIMAL string, never through a JS number.
      expect(movement.amount).toBe('12000000.00');
    });

    it('leaves NO budget behind when the plan cannot be raised — the case that stranded 1.106', async () => {
      const before = { budgets: await countBudgets(), docs: await countDocs(), movements: await countMovements() };

      // Routed through a department the plan type is not enabled for: unroutable, exactly as the
      // customer's company was when it had no ACTIVATE_BUDGET type at all.
      const n = await node();
      await expect(
        asCtx(() => plans.propose(proposal(n, { departmentId: ids.otherDept }))),
      ).rejects.toThrow();

      // The whole point. Under the two-call version the budget was already committed here, and no
      // second attempt at the same line was possible ever again.
      expect(await countBudgets()).toBe(before.budgets);
      expect(await countDocs()).toBe(before.docs);
      expect(await countMovements()).toBe(before.movements);
    });

    it('refuses the same dimension twice as a conflict, not as a crash from the index', async () => {
      const n = await node();
      await asCtx(() => plans.propose(proposal(n)));

      // Before this, the partial unique index raised straight out of the ORM as a 500 with nothing
      // a user could act on.
      await expect(asCtx(() => plans.propose(proposal(n)))).rejects.toThrow(ConflictException);
    });

    it('leaves nothing behind when the duplicate is refused', async () => {
      const n = await node();
      await asCtx(() => plans.propose(proposal(n)));
      const after = { budgets: await countBudgets(), docs: await countDocs() };

      await expect(asCtx(() => plans.propose(proposal(n)))).rejects.toThrow(ConflictException);

      expect(await countBudgets()).toBe(after.budgets);
      expect(await countDocs()).toBe(after.docs);
    });

    it('lets two proposals race for one dimension: one wins, one is refused, none is stranded', async () => {
      const n = await node();
      const before = await countBudgets();

      const results = await Promise.allSettled([
        asCtx(() => plans.propose(proposal(n))),
        asCtx(() => plans.propose(proposal(n))),
      ]);
      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r) => r.status === 'rejected');

      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      // The loser's budget must not survive its own failure — that is the stranding, arrived at by
      // a race rather than by a misconfiguration.
      expect(await countBudgets()).toBe(before + 1);
    });
  });

  describe('re-proposing a budget that lost its plan', () => {
    /** A budget written the old way: the insert alone, no plan. Exactly the stranded shape. */
    async function stranded(): Promise<string> {
      const n = await node();
      const budget = await asCtx(() => budgets.create(proposal(n) as never));
      return budget.id;
    }

    it('raises a plan for it and returns the document', async () => {
      const budgetId = await stranded();
      expect(await asCtx(() => plans.planForBudget(budgetId))).toBeNull();

      const { documentId } = await asCtx(() => plans.repropose(budgetId));

      const em = orm.em.fork();
      const movement = await em.findOneOrFail(BudgetMovement, { document: documentId }, { ...FILTER_OFF, populate: ['toBudget'] });
      expect(movement.toBudget!.id).toBe(budgetId);
      expect(movement.movementType).toBe(PLAN_POST_ACTION);
    });

    it('refuses a budget that is already in force, and says so', async () => {
      const budgetId = await stranded();
      const em = orm.em.fork();
      const b = await em.findOneOrFail(Budget, { id: budgetId }, FILTER_OFF);
      b.status = 'ACTIVE';
      await em.flush();

      // Each refusal names its OWN condition: "already in force", "another company's" and
      // "already has a plan" send a reader to three different actions.
      await expect(asCtx(() => plans.repropose(budgetId))).rejects.toThrow(BadRequestException);
      await expect(asCtx(() => plans.repropose(budgetId))).rejects.toThrow(/ACTIVE/);
    });

    it('refuses one that a plan already carries, naming that plan', async () => {
      const budgetId = await stranded();
      await asCtx(() => plans.repropose(budgetId));

      await expect(asCtx(() => plans.repropose(budgetId))).rejects.toThrow(ConflictException);
      await expect(asCtx(() => plans.repropose(budgetId))).rejects.toThrow(/already carried by plan/);
    });

    it("does not resolve another company's budget at all", async () => {
      // Written straight into company B — a DRAFT budget with no plan, i.e. re-proposable in every
      // respect EXCEPT the one that matters.
      const em = orm.em.fork();
      const n = em.create(BudgetNode, { fiscalYear: em.getReference(FiscalYear, ids.fyOther), code: `9.${seq++}`, name: 'other' });
      const foreign = em.create(Budget, {
        fiscalYear: em.getReference(FiscalYear, ids.fyOther),
        department: em.getReference(Department, ids.otherDept),
        node: n,
        amountTotal: '1000',
        status: 'DRAFT',
      });
      await em.persistAndFlush(foreign);

      // Invariant 1. NOT FOUND, not forbidden: the caller must not learn it exists.
      await expect(asCtx(() => plans.repropose(foreign.id))).rejects.toThrow(NotFoundException);
    });
  });
});
