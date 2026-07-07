import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { BudgetTxnType, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Workflow } from '../approval/approval.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { seedDatabase } from '../../seed/seed-data';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetService } from './budget.service';
import { AccountService } from '../accounting/account.service';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Budget, BudgetTxn } from './budget.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('budget reads: breakdown, ledger, company scope (DB-backed)', () => {
  let orm: MikroORM;
  let budgets: BudgetService;
  let balance: BudgetBalanceService;
  let companyA = '';
  let budgetAId = '';
  let budgetBId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    budgets = new BudgetService(orm.em, new AccountService(orm.em, new CompanyScopeService(orm.em)));
    balance = new BudgetBalanceService(orm.em);

    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: 'DEMO' }, FILTER_OFF)).id;
    budgetAId = (await em.findOneOrFail(Budget, { glAccount: '5000' }, { ...FILTER_OFF, populate: ['fiscalYear'] })).id;

    // A RESERVE txn against a real document, so reserved/available shift.
    const dept = await em.findOneOrFail(Department, { company: companyA, deptCode: 'PROC' }, FILTER_OFF);
    const prType = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(DeptDocType, { department: dept.id, documentType: prType.id }, { populate: ['formTemplate', 'workflow'], ...FILTER_OFF });
    const requester = await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF);
    const doc = em.create(Document, {
      docNo: 'PR-RES-1', company: em.getReference(Company, companyA), department: dept,
      documentType: prType, formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id), createdBy: requester,
      status: DocStatus.IN_APPROVAL, currentStepNo: 1, baseTotalAmount: '250000.00', createdAt: new Date(),
    });
    await em.flush();
    em.create(BudgetTxn, { budget: em.getReference(Budget, budgetAId), document: doc, txnType: BudgetTxnType.RESERVE, amount: '250000.00', remark: 'reserve on submit', createdAt: new Date() });
    await em.flush();

    // A second company with its own budget — must never be visible from company A.
    const thb = await em.findOneOrFail(Currency, { code: 'THB' }, FILTER_OFF);
    const compB = em.create(Company, { code: 'DEMO2', nameTh: 'บีโค', nameEn: 'B Co', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const deptB = em.create(Department, { company: compB, deptCode: 'PROC', name: 'Proc B', isActive: true });
    const fyB = em.create(FiscalYear, { company: compB, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const budgetB = em.create(Budget, { fiscalYear: fyB, department: deptB, glAccount: '5000', budgetName: 'B budget', amountTotal: '500000', status: 'ACTIVE' });
    await em.flush();
    budgetBId = budgetB.id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: 'u', companyId: companyA, departmentId: '', grants: [] }, fn);

  it('breakdown reconciles and reflects the reservation', async () => {
    const b = await asA(() => balance.breakdown(budgetAId));
    expect(Number(b.amountTotal)).toBe(1_000_000);
    expect(Number(b.reserved)).toBe(250_000);
    expect(Number(b.available)).toBe(750_000); // 1,000,000 − 250,000 reserved
  });

  it('ledger returns the budget\'s entries with the source document', async () => {
    const { items: rows, total } = await asA(() => balance.ledger(budgetAId));
    expect(total).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].txnType).toBe(BudgetTxnType.RESERVE);
    expect(rows[0].documentNo).toBe('PR-RES-1');
  });

  it('does not return another company\'s budget', async () => {
    const { items: list } = await asA(() => budgets.list());
    expect(list.map((x) => x.id)).toContain(budgetAId);
    expect(list.map((x) => x.id)).not.toContain(budgetBId);
    await expect(asA(() => balance.breakdown(budgetBId))).rejects.toThrow();
    await expect(asA(() => balance.ledger(budgetBId))).rejects.toThrow();
  });
});
