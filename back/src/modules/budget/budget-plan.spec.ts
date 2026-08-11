import { BadRequestException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { Account } from '../accounting/accounting.entities';
import { Workflow } from '../approval/approval.entities';
import { DeptDocTypeService } from '../document/dept-doc-type.service';
import { NumberingService } from '../document/numbering.service';
import {
  DeptDocType,
  Document,
  DocumentType,
  FormTemplate,
} from '../document/document.entities';
import {
  Company,
  Department,
  FiscalYear,
} from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetCoverageService } from './budget-coverage.service';
import { BudgetLedgerService } from './budget-ledger.service';
import { BudgetPlanService, PLAN_POST_ACTION } from './budget-plan.service';
import { BudgetService } from './budget.service';
import {
  Budget,
  BudgetControlPoint,
  BudgetMovement,
  BudgetTxn,
} from './budget.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;
const hasDb = await dbAvailable();

/**
 * Budget plans — the approval gate in front of setting a budget.
 *
 * Creating a budget used to be the one budget operation nobody approved: moving a kip between two
 * budgets took a document and a workflow, while setting a ceiling of any size took one call. These
 * specs pin the replacement: a budget is created DRAFT, a plan proposes it, and only full approval
 * puts it in force — all of it, or none of it.
 */
describe.skipIf(!hasDb)('budget plans (DB-backed)', () => {
  let orm: MikroORM;
  let budgets: BudgetService;
  let plans: BudgetPlanService;
  let coverage: BudgetCoverageService;
  let ledger: BudgetLedgerService;

  const ids = {
    company: '',
    other: '',
    user: '',
    // Department tree: root → child. `outside` is a second root, so it is in the company but NOT
    // under the routing department.
    root: '',
    child: '',
    outside: '',
    otherDept: '',
    fyOpen: '',
    fyClosed: '',
    fyOther: '',
    planType: '',
    template: '',
    workflow: '',
    spendType: '',
  };
  let seq = 0;

  function asCtx<T>(fn: () => Promise<T>, companyId = ids.company): Promise<T> {
    return RequestContext.run(
      { companyId, departmentId: ids.root, userId: ids.user, grants: [] },
      fn,
    );
  }

  /** A postable account of its own, so each test's control points are its own. */
  async function account(companyId = ids.company): Promise<string> {
    const code = `5${seq++}00`;
    const em = orm.em.fork();
    const a = em.create(Account, {
      company: em.getReference(Company, companyId),
      code,
      name: code,
      accountType: 'EXPENSE' as never,
      isPostable: true,
      isActive: true,
    });
    await em.persistAndFlush(a);
    return code;
  }

  /** Propose a budget: DRAFT, spendable by nobody, governed by nothing. */
  async function draft(
    glAccount: string,
    departmentId = ids.child,
    amountTotal = '100000',
    fiscalYearId = ids.fyOpen,
    companyId = ids.company,
  ): Promise<Budget> {
    return asCtx(
      () =>
        budgets.create({
          fiscalYearId,
          departmentId,
          glAccount,
          amountTotal,
        }),
      companyId,
    );
  }

  async function plan(
    budgetIds: string[],
    departmentId = ids.root,
  ): Promise<string> {
    const { documentId } = await asCtx(() =>
      plans.create({
        departmentId,
        lines: budgetIds.map((budgetId) => ({ budgetId })),
      }),
    );
    return documentId;
  }

  /** Run the post-action the way full approval does — inside one transaction. */
  async function activate(documentId: string): Promise<void> {
    const em = orm.em.fork();
    const document = await em.findOneOrFail(
      Document,
      { id: documentId },
      FILTER_OFF,
    );
    await em.transactional((tem) => plans.activate(document, tem));
  }

  async function reject(documentId: string): Promise<void> {
    const em = orm.em.fork();
    await em.transactional((tem) => plans.markRejected(documentId, tem));
  }

  async function statusOf(budgetId: string): Promise<string> {
    return (
      await orm.em.fork().findOneOrFail(Budget, { id: budgetId }, FILTER_OFF)
    ).status;
  }

  async function countTxns(): Promise<number> {
    return orm.em.fork().count(BudgetTxn, {}, FILTER_OFF);
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();

    const company = em.create(Company, {
      code: 'A',
      nameTh: 'A',
      taxId: '1',
      branchCode: '00000',
      isActive: true,
    });
    const other = em.create(Company, {
      code: 'B',
      nameTh: 'B',
      taxId: '2',
      branchCode: '00000',
      isActive: true,
    });
    const root = em.create(Department, {
      company,
      deptCode: 'ROOT',
      name: 'ROOT',
      isActive: true,
    });
    const child = em.create(Department, {
      company,
      deptCode: 'CHILD',
      name: 'CHILD',
      parentDept: root,
      isActive: true,
    });
    const outside = em.create(Department, {
      company,
      deptCode: 'OUT',
      name: 'OUT',
      isActive: true,
    });
    const otherDept = em.create(Department, {
      company: other,
      deptCode: 'BD',
      name: 'BD',
      isActive: true,
    });
    const fyOpen = em.create(FiscalYear, {
      company,
      year: 2026,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'OPEN',
    });
    const fyClosed = em.create(FiscalYear, {
      company,
      year: 2025,
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      status: 'CLOSED',
    });
    const fyOther = em.create(FiscalYear, {
      company: other,
      year: 2026,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'OPEN',
    });
    const user = em.create(AppUser, {
      username: 'u',
      email: 'u@x',
      status: 'ACTIVE',
    });
    const workflow = em.create(Workflow, {
      company,
      name: 'WF',
      isActive: true,
    });

    // Resolved by post_action, not by code — the code here is deliberately not the seeded one.
    const planType = em.create(DocumentType, {
      company,
      code: 'PLAN_X',
      name: 'Budget plan',
      category: 'FINANCE',
      requiresBudget: false,
      requiresQuota: false,
      requiresVendor: false,
      requiresItem: false,
      isActive: true,
      postAction: PLAN_POST_ACTION,
    });
    const template = em.create(FormTemplate, {
      documentType: planType,
      version: 1,
      status: 'PUBLISHED',
    });
    em.create(DeptDocType, {
      department: root,
      documentType: planType,
      formTemplate: template,
      workflow,
      isActive: true,
    });

    // An ordinary spending type, for the concurrency test's reserving document.
    const spendType = em.create(DocumentType, {
      company,
      code: 'SPEND',
      name: 'Spend',
      category: 'FINANCE',
      requiresBudget: true,
      requiresQuota: false,
      requiresVendor: false,
      requiresItem: false,
      isActive: true,
      postAction: 'CUT_BUDGET',
    });
    em.create(FormTemplate, {
      documentType: spendType,
      version: 1,
      status: 'PUBLISHED',
    });

    await em.persistAndFlush(company);
    Object.assign(ids, {
      company: company.id,
      other: other.id,
      user: user.id,
      root: root.id,
      child: child.id,
      outside: outside.id,
      otherDept: otherDept.id,
      fyOpen: fyOpen.id,
      fyClosed: fyClosed.id,
      fyOther: fyOther.id,
      planType: planType.id,
      template: template.id,
      workflow: workflow.id,
      spendType: spendType.id,
    });

    const m = orm.em;
    const scope = new CompanyScopeService(m);
    coverage = new BudgetCoverageService(m);
    budgets = new BudgetService(
      m,
      new AccountService(m, scope),
      new BudgetBalanceService(m),
    );
    plans = new BudgetPlanService(
      m,
      new DeptDocTypeService(m),
      new NumberingService(m),
      coverage,
    );
    ledger = new BudgetLedgerService(m, new BudgetBalanceService(m), coverage);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  // ---- Intake ------------------------------------------------------------------------------

  describe('intake', () => {
    it('creates one document carrying a movement per proposed budget', async () => {
      const a = await draft(await account());
      const b = await draft(await account());
      const documentId = await plan([a.id, b.id]);

      const em = orm.em.fork();
      const movements = await em.find(
        BudgetMovement,
        { document: documentId },
        FILTER_OFF,
      );
      expect(movements).toHaveLength(2);
      expect(
        movements.every((mv) => mv.movementType === PLAN_POST_ACTION),
      ).toBe(true);
      // ...and nothing is in force yet.
      expect(await statusOf(a.id)).toBe('DRAFT');
      expect(await statusOf(b.id)).toBe('DRAFT');
    });

    it('reserves nothing — a plan proposes budget, it does not consume any', async () => {
      const before = await countTxns();
      const a = await draft(await account());
      await plan([a.id]);
      expect(await countTxns()).toBe(before);
    });

    it('refuses a budget that is already in force', async () => {
      const a = await draft(await account());
      await activate(await plan([a.id]));
      await expect(plan([a.id])).rejects.toThrow(BadRequestException);
    });

    it('refuses the same budget twice on one plan', async () => {
      // Two movements pointing at one budget would activate it once and count it twice in the
      // plan's total — a plan that says something different from what it does.
      const a = await draft(await account());
      await expect(plan([a.id, a.id])).rejects.toThrow(BadRequestException);
    });

    it('refuses a budget belonging to another company', async () => {
      const code = await account(ids.other);
      const foreign = await draft(
        code,
        ids.otherDept,
        '100000',
        ids.fyOther,
        ids.other,
      );
      await expect(plan([foreign.id])).rejects.toThrow(BadRequestException);
    });

    it('accepts a line for a department below the routing department', async () => {
      const a = await draft(await account(), ids.child);
      await expect(plan([a.id], ids.root)).resolves.toBeTruthy();
    });

    it('refuses a line outside the routing department’s subtree', async () => {
      // A plan is approved by the routing department's workflow. A line elsewhere would be signed
      // off by people with no authority over it.
      const a = await draft(await account(), ids.outside);
      await expect(plan([a.id], ids.root)).rejects.toThrow(BadRequestException);
    });
  });

  // ---- The dimension slot ------------------------------------------------------------------

  describe('the dimension slot', () => {
    it('is held by a DRAFT budget, so two plans cannot propose the same line', async () => {
      const code = await account();
      await draft(code, ids.child);
      await expect(draft(code, ids.child)).rejects.toThrow();
    });

    it('is released by a REJECTED one, so a refused line can be proposed again', async () => {
      const code = await account();
      const first = await draft(code, ids.child);
      await reject(await plan([first.id]));
      expect(await statusOf(first.id)).toBe('REJECTED');
      await expect(draft(code, ids.child)).resolves.toBeTruthy();
    });
  });

  // ---- Activation --------------------------------------------------------------------------

  describe('activation', () => {
    it('puts every budget on the plan in force, each governed', async () => {
      const a = await draft(await account());
      const b = await draft(await account());
      await activate(await plan([a.id, b.id]));

      expect(await statusOf(a.id)).toBe('ACTIVE');
      expect(await statusOf(b.id)).toBe('ACTIVE');
      expect((await coverage.controlPointsFor(a.id)).length).toBeGreaterThan(0);
      expect((await coverage.controlPointsFor(b.id)).length).toBeGreaterThan(0);
    });

    it('writes no ledger row — an opening figure is a column, not a transaction', async () => {
      const a = await draft(await account());
      const documentId = await plan([a.id]);
      const before = await countTxns();
      await activate(documentId);
      expect(await countTxns()).toBe(before);
    });

    it('mints ONE control point for two lines that need the same one', async () => {
      // The coverage resolver memoises per EntityManager. A per-line loop would read the empty
      // array it cached before the first line's insert, mint a second point for the same node, and
      // fail on the unique constraint at flush — far from the line that caused it. This is the
      // test that fails if activation ever goes back to looping.
      const code = await account();
      const a = await draft(code, ids.child);
      const b = await draft(code, ids.root);
      await activate(await plan([a.id, b.id]));

      const em = orm.em.fork();
      const acc = await em.findOneOrFail(
        Account,
        { code, company: ids.company },
        FILTER_OFF,
      );
      const points = await em.find(
        BudgetControlPoint,
        { accountNode: acc.id, fiscalYear: ids.fyOpen },
        FILTER_OFF,
      );
      expect(points).toHaveLength(1);
      // Shallowest department first, deterministically — so the point lands as high in the tree as
      // the plan reaches, and both lines fall under it.
      expect(points[0].departmentNode.id).toBe(ids.root);
      expect((await coverage.controlPointsFor(a.id)).map((c) => c.id)).toEqual([
        points[0].id,
      ]);
      expect((await coverage.controlPointsFor(b.id)).map((c) => c.id)).toEqual([
        points[0].id,
      ]);
    });

    it('is refused for a fiscal year that is not OPEN, and activates nothing', async () => {
      const a = await draft(await account(), ids.child, '100000', ids.fyClosed);
      const b = await draft(await account(), ids.child, '100000', ids.fyClosed);
      const documentId = await plan([a.id, b.id]);
      await expect(activate(documentId)).rejects.toThrow(BadRequestException);
      expect(await statusOf(a.id)).toBe('DRAFT');
      expect(await statusOf(b.id)).toBe('DRAFT');
    });

    it('activates all or nothing when one line cannot be activated', async () => {
      // One line in a closed year is enough to stop the plan — the other stays DRAFT with it.
      const good = await draft(await account(), ids.child);
      const bad = await draft(
        await account(),
        ids.child,
        '100000',
        ids.fyClosed,
      );
      const documentId = await plan([good.id, bad.id]);
      await expect(activate(documentId)).rejects.toThrow(BadRequestException);
      expect(await statusOf(good.id)).toBe('DRAFT');
      expect(await statusOf(bad.id)).toBe('DRAFT');
    });
  });

  // ---- Rejection ---------------------------------------------------------------------------

  describe('rejection', () => {
    it('marks the budgets REJECTED and keeps the rows', async () => {
      const a = await draft(await account());
      const documentId = await plan([a.id]);
      await reject(documentId);

      expect(await statusOf(a.id)).toBe('REJECTED');
      // The movement still points at it — the record of what was refused survives.
      const em = orm.em.fork();
      const movements = await em.find(
        BudgetMovement,
        { document: documentId },
        FILTER_OFF,
      );
      expect(movements[0].toBudget!.id).toBe(a.id);
    });

    it('releases nothing, because a plan held nothing', async () => {
      const a = await draft(await account());
      const documentId = await plan([a.id]);
      const before = await countTxns();
      await reject(documentId);
      expect(await countTxns()).toBe(before);
    });

    it('leaves an already-activated budget alone', async () => {
      // The hook is shared with cancel and runs more than once. Re-running it must not undo an
      // activation the approvers granted.
      const a = await draft(await account());
      const documentId = await plan([a.id]);
      await activate(documentId);
      await reject(documentId);
      expect(await statusOf(a.id)).toBe('ACTIVE');
    });
  });

  // ---- Concurrency -------------------------------------------------------------------------

  describe('concurrency', () => {
    it('serializes activation against a reservation under the same control point', async () => {
      // A control point's ceiling is the sum of the budgets it governs, so activating a plan
      // raises it while a reservation is deciding against it. Both take the control point
      // FOR UPDATE in ascending id order, so they queue rather than deadlock.
      const code = await account();
      const first = await draft(code, ids.root, '100000');
      await activate(await plan([first.id]));

      // A second budget under the SAME control point (same account node, department below it).
      const second = await draft(code, ids.child, '100000');
      const planId = await plan([second.id]);

      const em = orm.em.fork();
      const doc = em.create(Document, {
        docNo: `SPEND-${seq++}`,
        company: em.getReference(Company, ids.company),
        department: em.getReference(Department, ids.root),
        documentType: em.getReference(DocumentType, ids.spendType),
        formTemplate: await em.findOneOrFail(
          FormTemplate,
          { documentType: ids.spendType },
          FILTER_OFF,
        ),
        workflow: em.getReference(Workflow, ids.workflow),
        currentStepNo: 0,
        createdBy: em.getReference(AppUser, ids.user),
        exchangeRate: '1',
        totalAmount: '50000',
        status: DocStatus.SUBMITTED,
        createdAt: new Date(),
      });
      await em.persistAndFlush(doc);

      const results = await Promise.allSettled([
        activate(planId),
        ledger.reserve(doc.id, [{ budgetId: first.id, baseAmount: '50000' }]),
      ]);

      // Neither is allowed to deadlock — the point of the shared lock order.
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(await statusOf(second.id)).toBe('ACTIVE');
      // One control point still governs both, whichever order they ran in.
      const governing = await coverage.controlPointsFor(second.id);
      expect(governing).toHaveLength(1);
      expect((await coverage.controlPointsFor(first.id))[0].id).toBe(
        governing[0].id,
      );
    });
  });
});

if (!hasDb) {
  console.warn('[budget-plan] no database reachable — skipping DB-backed spec');
}
