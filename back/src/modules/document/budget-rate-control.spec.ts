import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachCoverage } from '../../test/budget-fixture';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { AccountService } from '../accounting/account.service';
import { ControlPolicy, DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { Budget } from '../budget/budget.entities';
import { Currency, ExchangeRate } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { ItemService } from '../master-data/item.service';
import { VendorService } from '../master-data/vendor.service';
import { ScopeService } from '../rbac/scope.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { PostActionService } from '../approval/post-action.service';
import { WorkflowStepResolver } from '../approval/workflow-step.resolver';
import { Workflow, WorkflowStep } from '../approval/approval.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { DocumentSubmitService } from './document-submit.service';
import { Document, DocumentLine, DocumentType, FormTemplate } from './document.entities';
import { TaxCode } from '../tax/tax.entities';
import { TaxKind } from '../../common/enums';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('budget rate control (BUDGET_RATE) (DB-backed)', () => {
  let orm: MikroORM;
  let submit: DocumentSubmitService;
  let budgetBalance: BudgetBalanceService;
  let budgetLedger: BudgetLedgerService;
  const ids = { company: '', dept: '', user: '', ua: '', ua2: '', prType: '', prTmpl: '', wf: '', wfBand: '', budget: '', vat7: '' };
  let seq = 0;

  const ref = <T>(cls: new (...a: any[]) => T, id: string) => orm.em.fork().getReference(cls as any, id) as any;
  const asCtx = <T>(fn: () => Promise<T>): Promise<T> =>
    RequestContext.run({ userId: ids.user, companyId: ids.company, departmentId: ids.dept, grants: [] }, fn);
  const reload = (id: string) => orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);

  async function draftDoc(currencyCode: string, lineAmount: string): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `R-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.prType),
      formTemplate: em.getReference(FormTemplate, ids.prTmpl),
      workflow: em.getReference(Workflow, ids.wf),
      createdBy: em.getReference(AppUser, ids.user),
      currency: em.getReference(Currency, currencyCode),
      totalAmount: lineAmount,
      status: DocStatus.DRAFT,
      createdAt: new Date(),
    });
    em.create(DocumentLine, { document: doc, lineNo: 1, description: 'X', qty: '1', unitPrice: lineAmount, lineAmount, budget: em.getReference(Budget, ids.budget) });
    await em.flush();
    return doc.id;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    em.create(Currency, { code: 'USD', name: 'Dollar', decimalPlaces: 2, isActive: true });
    em.create(Currency, { code: 'EUR', name: 'Euro', decimalPlaces: 2, isActive: true });
    // USD: daily 35, budget 30 (group). EUR: daily 40 only (no BUDGET_RATE → fallback).
    em.create(ExchangeRate, { fromCurrency: em.getReference(Currency, 'USD'), toCurrency: thb, rate: '35', rateDate: '2026-01-01', rateType: 'DAILY' });
    em.create(ExchangeRate, { fromCurrency: em.getReference(Currency, 'USD'), toCurrency: thb, rate: '30', rateDate: '2026-01-01', rateType: 'BUDGET_RATE' });
    em.create(ExchangeRate, { fromCurrency: em.getReference(Currency, 'EUR'), toCurrency: thb, rate: '40', rateDate: '2026-01-01', rateType: 'DAILY' });

    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const dept = em.create(Department, { company, deptCode: 'DA', name: 'DA', isActive: true });
    const fy = em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const ua = em.create(AppUser, { username: 'ua', email: 'ua@x', status: 'ACTIVE' });
    const ua2 = em.create(AppUser, { username: 'ua2', email: 'ua2@x', status: 'ACTIVE' });
    const prType = em.create(DocumentType, { company: company, code: 'PR', name: 'PR', category: DocCategory.PROCUREMENT, requiresBudget: true, requiresQuota: false, postAction: 'CUT_BUDGET', isActive: true });
    const prTmpl = em.create(FormTemplate, { documentType: prType, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    const budget = em.create(Budget, { fiscalYear: fy, department: dept, glAccount: 'GL1', amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    attachCoverage(em, company, budget);
    const vat7 = em.create(TaxCode, { company, code: 'VAT7', name: 'VAT 7%', kind: TaxKind.VAT, rate: '0.07', isActive: true });
    // Banding workflow: step 2 only above 3200 base.
    const wfBand = em.create(Workflow, { company, name: 'WF-BAND', isActive: true });
    em.create(WorkflowStep, { workflow: wfBand, stepNo: 1, approverUser: ua, approveMode: 'SEQUENTIAL' });
    em.create(WorkflowStep, { workflow: wfBand, stepNo: 2, approverUser: ua2, amountMin: '3200', approveMode: 'SEQUENTIAL' });
    await em.flush();
    Object.assign(ids, { company: company.id, dept: dept.id, user: user.id, ua: ua.id, ua2: ua2.id, prType: prType.id, prTmpl: prTmpl.id, wf: wf.id, wfBand: wfBand.id, budget: budget.id, vat7: vat7.id });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    const scope = new CompanyScopeService(orm.em);
    budgetBalance = new BudgetBalanceService(orm.em);
    budgetLedger = new BudgetLedgerService(orm.em, budgetBalance, new BudgetCoverageService(orm.em));
    submit = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      new FiscalYearService(scope),
      new VendorService(orm.em, scope, new ScopeService()),
      new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope)),
      budgetLedger,
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
  });

  it('reserves at the BUDGET_RATE while recording the daily rate', async () => {
    const id = await draftDoc('USD', '100');
    await asCtx(() => submit.submit(id));

    const doc = await reload(id);
    expect(Number(doc.exchangeRate)).toBe(35); // daily, recorded
    expect(Number(doc.baseTotalAmount)).toBe(3500); // daily base
    expect(Number(doc.budgetExchangeRate)).toBe(30); // budget rate
    expect(Number(doc.budgetBaseTotalAmount)).toBe(3000); // budget base
    expect(Number(await budgetBalance.outstandingReserved(id, ids.budget))).toBe(3000); // reserved at budget rate
  });

  it('falls back to the daily rate when no BUDGET_RATE exists', async () => {
    const id = await draftDoc('EUR', '100');
    await asCtx(() => submit.submit(id));

    const doc = await reload(id);
    expect(Number(doc.baseTotalAmount)).toBe(4000);
    expect(Number(doc.budgetBaseTotalAmount)).toBe(4000); // == daily base
    expect(Number(await budgetBalance.outstandingReserved(id, ids.budget))).toBe(4000);
  });

  it('settles to zero outstanding at the same budget base it reserved', async () => {
    const id = await draftDoc('USD', '100');
    await asCtx(() => submit.submit(id));
    expect(Number(await budgetBalance.outstandingReserved(id, ids.budget))).toBe(3000);

    const postAction = new PostActionService(budgetLedger, orm.em);
    const doc = await orm.em.fork().findOneOrFail(Document, { id }, { ...FILTER_OFF, populate: ['documentType', 'company'] });
    await asCtx(() => orm.em.fork().transactional((tem: EntityManager) => postAction.run(doc, tem)));

    expect(Number(await budgetBalance.outstandingReserved(id, ids.budget))).toBe(0);
  });

  it('computes VAT and stamps document totals without changing the budget basis', async () => {
    // THB document (rate 1), one line net 1000 with a 7% VAT code.
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `V-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.prType),
      formTemplate: em.getReference(FormTemplate, ids.prTmpl),
      workflow: em.getReference(Workflow, ids.wf),
      createdBy: em.getReference(AppUser, ids.user),
      currency: em.getReference(Currency, 'THB'),
      totalAmount: '1000', status: DocStatus.DRAFT, createdAt: new Date(),
    });
    em.create(DocumentLine, {
      document: doc, lineNo: 1, description: 'X', qty: '1', unitPrice: '1000', lineAmount: '1000',
      taxCode: em.getReference(TaxCode, ids.vat7), budget: em.getReference(Budget, ids.budget),
    });
    await em.flush();

    await asCtx(() => submit.submit(doc.id));
    const reloaded = await reload(doc.id);
    const line = await orm.em.fork().findOneOrFail(DocumentLine, { document: doc.id, lineNo: 1 }, FILTER_OFF);

    expect(Number(reloaded.subTotal)).toBe(1000);
    expect(Number(reloaded.taxTotal)).toBe(70);
    expect(Number(reloaded.grandTotal)).toBe(1070);
    expect(Number(reloaded.baseTaxTotal)).toBe(70);
    expect(Number(reloaded.baseTotalAmount)).toBe(1070); // tax-inclusive payment/FX basis
    expect(Number(reloaded.budgetBaseTotalAmount)).toBe(1000); // budget stays pre-tax
    expect(Number(await budgetBalance.outstandingReserved(doc.id, ids.budget))).toBe(1000); // reserved net
    expect(Number(line.taxAmount)).toBe(70);
  });

  it('bands approval steps by the budget base, not the daily base', async () => {
    // USD 100 → daily base 3500 (≥ 3200 would include step 2), budget base 3000 (< 3200 excludes it).
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `B-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.prType),
      formTemplate: em.getReference(FormTemplate, ids.prTmpl),
      workflow: em.getReference(Workflow, ids.wfBand),
      createdBy: em.getReference(AppUser, ids.user),
      exchangeRate: '35', baseTotalAmount: '3500', budgetExchangeRate: '30', budgetBaseTotalAmount: '3000',
      status: DocStatus.SUBMITTED, submittedAt: new Date(), createdAt: new Date(),
    });
    await em.flush();

    const resolver = new WorkflowStepResolver(orm.em);
    const loaded = await orm.em.fork().findOneOrFail(Document, { id: doc.id }, { ...FILTER_OFF, populate: ['workflow', 'company', 'createdBy'] });
    const applicable = await resolver.applicableSteps(loaded, orm.em.fork());
    expect(applicable.map((s) => s.stepNo)).toEqual([1]); // step 2 excluded by the budget base
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[budget-rate-control] no database reachable — skipping DB-backed spec');
}
