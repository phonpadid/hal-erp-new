import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { AccountService } from '../accounting/account.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetService } from '../budget/budget.service';
import { Budget, BudgetMovement, BudgetNode } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { ItemService } from '../master-data/item.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DeptDocType, Document, DocumentType, FormTemplate } from './document.entities';
import { DocumentService } from './document.service';
import { NumberingService } from './numbering.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

/**
 * A budget plan's content lives on `budget_movement`, not on `document_line`, and the detail read
 * never queried that table.
 *
 * So `BUDGET_PLAN-HAL-2026-0001` rendered as a 12,000,000 document reading "no items", and was
 * approved by somebody whose screen never named budget 1.106. The writing half of this split was
 * solved — `document_type.content_route` sends the requester to the screen that can author such
 * content — and the reading half was never noticed, because nothing errors: the page simply says a
 * document with nothing in it.
 *
 * `budgetMovements` is asserted as ALWAYS PRESENT, empty for a document that moves no budget. An
 * absent key cannot distinguish "moves nothing" from "was not read", and that difference is the
 * whole point on a screen an approver signs against.
 */
describe.skipIf(!hasDb)('a document reports the budget it moves (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  const ids = {
    company: '', dept: '', user: '',
    planType: '', adjType: '', memoType: '',
    budget: '', otherCompany: '', otherDept: '', otherUser: '', otherType: '',
  };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const lak = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 0, isActive: true });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: lak, isActive: true });
    const dept = em.create(Department, { company, deptCode: 'ADM', name: 'Administration', isActive: true });
    const y = new Date().getUTCFullYear();
    const fy = em.create(FiscalYear, { company, year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'OPEN' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    const user = em.create(AppUser, { username: 'raiser', email: 'raiser@x', status: 'ACTIVE', passwordHash: 'x' });

    // The budget a movement points at. Its code lives on the NODE — `budget` carries none — which
    // is exactly the resolution the read has to perform for the screen to show `1.106` at all.
    const node = em.create(BudgetNode, { fiscalYear: fy, code: '1.106', name: 'Support and subsidies' });
    const budget = em.create(Budget, {
      fiscalYear: fy, department: dept, node,
      budgetName: 'Support, subsidies and other (state)',
      amountTotal: '12000000.00', status: 'DRAFT',
    });

    // Three types: one whose content is movements, one adjustment, one whose content is lines.
    const mk = (code: string, name: string, postAction?: string) => {
      const t = em.create(DocumentType, {
        company, code, name, category: DocCategory.FINANCE, postAction,
        requiresBudget: false, requiresQuota: false, isActive: true,
      });
      const tmpl = em.create(FormTemplate, { documentType: t, version: 1, status: 'PUBLISHED' });
      em.create(DeptDocType, { department: dept, documentType: t, formTemplate: tmpl, workflow: wf, isActive: true });
      return t;
    };
    const planType = mk('BUDGET_PLAN', 'Budget plan', 'ACTIVATE_BUDGET');
    const adjType = mk('BUDGET_ADJ_INC', 'Budget increase', 'ADJUST_INCREASE');
    const memoType = mk('DISBURSE', 'Disbursement', 'CUT_BUDGET');

    // A second company, for the isolation check. Its own everything — a company that shares a row
    // with the first proves nothing about isolation.
    const otherCompany = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: lak, isActive: true });
    const otherDept = em.create(Department, { company: otherCompany, deptCode: 'B1', name: 'B1', isActive: true });
    em.create(FiscalYear, { company: otherCompany, year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'OPEN' });
    const otherWf = em.create(Workflow, { company: otherCompany, name: 'WF-B', isActive: true });
    const otherUser = em.create(AppUser, { username: 'other', email: 'other@x', status: 'ACTIVE', passwordHash: 'x' });
    const otherType = em.create(DocumentType, {
      company: otherCompany, code: 'BUDGET_PLAN', name: 'Budget plan', category: DocCategory.FINANCE,
      postAction: 'ACTIVATE_BUDGET', requiresBudget: false, requiresQuota: false, isActive: true,
    });
    const otherTmpl = em.create(FormTemplate, { documentType: otherType, version: 1, status: 'PUBLISHED' });
    em.create(DeptDocType, { department: otherDept, documentType: otherType, formTemplate: otherTmpl, workflow: otherWf, isActive: true });

    await em.flush();
    Object.assign(ids, {
      company: company.id, dept: dept.id, user: user.id,
      planType: planType.id, adjType: adjType.id, memoType: memoType.id,
      budget: budget.id,
      otherCompany: otherCompany.id, otherDept: otherDept.id, otherUser: otherUser.id, otherType: otherType.id,
    });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    const scope = new CompanyScopeService(orm.em);
    const accounts = new AccountService(orm.em, scope);
    documents = new DocumentService(
      orm.em,
      scope,
      new DeptDocTypeService(orm.em),
      new NumberingService(orm.em),
      new ItemService(orm.em, scope, new ScopeService(), accounts),
      new BudgetService(orm.em, accounts, new BudgetBalanceService(orm.em)),
      new FiscalYearService(scope),
    );
  });

  const asRaiser = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: ids.user, companyId: ids.company, departmentId: ids.dept, grants: [] }, fn);

  /** A draft of `typeId` plus, when an amount is given, the movement its intake would have written. */
  async function documentMoving(typeId: string, movementType?: string, amount?: string) {
    const draft = await asRaiser(() => documents.createDraft({ documentTypeId: typeId }));
    if (movementType && amount) {
      const em = orm.em.fork();
      em.create(BudgetMovement, {
        company: em.getReference(Company, ids.company),
        document: em.getReference(Document, draft.id),
        movementType,
        toBudget: em.getReference(Budget, ids.budget),
        amount,
      });
      await em.flush();
    }
    return draft.id;
  }

  it('reports the ACTIVATE_BUDGET movement of a budget plan, naming the budget and the amount', async () => {
    const id = await documentMoving(ids.planType, 'ACTIVATE_BUDGET', '12000000.00');
    const { budgetMovements } = await asRaiser(() => documents.detail(id));

    expect(budgetMovements).toHaveLength(1);
    expect(budgetMovements[0]).toMatchObject({
      movementType: 'ACTIVATE_BUDGET',
      // A STRING. Money never becomes a JS number on the way out; 12000000 would still read as
      // twelve million here and would be the wrong type on a figure that can carry decimals.
      amount: '12000000.00',
      toBudget: {
        id: ids.budget,
        code: '1.106',
        name: 'Support, subsidies and other (state)',
        department: { deptCode: 'ADM', name: 'Administration' },
      },
    });
    expect(typeof budgetMovements[0].amount).toBe('string');
  });

  it('reports an adjustment as ADJUST_INCREASE with its amount', async () => {
    const id = await documentMoving(ids.adjType, 'ADJUST_INCREASE', '65004000.00');
    const { budgetMovements } = await asRaiser(() => documents.detail(id));

    expect(budgetMovements).toHaveLength(1);
    expect(budgetMovements[0].movementType).toBe('ADJUST_INCREASE');
    expect(budgetMovements[0].amount).toBe('65004000.00');
    expect(budgetMovements[0].toBudget?.code).toBe('1.106');
  });

  it('reports an EMPTY list — not an absent key — for a document whose content is lines', async () => {
    const id = await documentMoving(ids.memoType);
    const detail = await asRaiser(() => documents.detail(id));

    // The distinction the screen depends on: "this document moves nothing" is a fact it can state,
    // "the movements were not read" is not.
    expect(detail).toHaveProperty('budgetMovements');
    expect(detail.budgetMovements).toEqual([]);
    expect(detail.lines).toEqual([]);
  });

  it('does not resolve another company\'s document, movements included', async () => {
    const id = await documentMoving(ids.planType, 'ACTIVATE_BUDGET', '12000000.00');

    // Invariant 1. The movement names a budget, so a leak here would hand company B both the
    // document and a budget it has no business seeing.
    await expect(
      RequestContext.run(
        { userId: ids.otherUser, companyId: ids.otherCompany, departmentId: ids.otherDept, grants: [] },
        () => documents.detail(id),
      ),
    ).rejects.toThrow(/not found/i);
  });
});
