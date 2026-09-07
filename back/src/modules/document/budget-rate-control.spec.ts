import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { AccountService } from '../accounting/account.service';
import { ControlPolicy, DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { AccountingPeriod } from '../accounting/period/accounting-period.entities';
import { Currency, ExchangeRate } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { ItemService } from '../master-data/item.service';
import { VendorService } from '../master-data/vendor.service';
import { ScopeService } from '../rbac/scope.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
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

  /** The same draft, on a type that records history, stating the day its money moved. */
  async function backdatedDraft(day: string, lineAmount: string): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `H-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.histType),
      formTemplate: em.getReference(FormTemplate, ids.histTmpl),
      workflow: em.getReference(Workflow, ids.wf),
      createdBy: em.getReference(AppUser, ids.user),
      currency: em.getReference(Currency, 'THB'),
      totalAmount: lineAmount,
      status: DocStatus.DRAFT,
      createdAt: new Date(),
      moneyMovedOn: day,
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
    const histType = em.create(DocumentType, { company: company, code: 'SPEND_HIST', name: 'history', category: DocCategory.PROCUREMENT, requiresBudget: true, requiresQuota: false, postAction: 'CUT_BUDGET', recordsPastEvents: true, isActive: true });
    const histTmpl = em.create(FormTemplate, { documentType: histType, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    const budget = budgetAt(em, { fiscalYear: fy, department: dept, code: 'GL1', glAccount: 'GL1', amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    attachCoverage(em, company, budget);
    const vat7 = em.create(TaxCode, { company, code: 'VAT7', name: 'VAT 7%', kind: TaxKind.VAT, rate: '0.07', isActive: true });
    // Banding workflow: step 2 only above 3200 base.
    const wfBand = em.create(Workflow, { company, name: 'WF-BAND', isActive: true });
    em.create(WorkflowStep, { workflow: wfBand, stepNo: 1, approverUser: ua, approveMode: 'SEQUENTIAL' });
    em.create(WorkflowStep, { workflow: wfBand, stepNo: 2, approverUser: ua2, amountMin: '3200', approveMode: 'SEQUENTIAL' });
    await em.flush();
    Object.assign(ids, { company: company.id, dept: dept.id, user: user.id, ua: ua.id, ua2: ua2.id, prType: prType.id, prTmpl: prTmpl.id, wf: wf.id, wfBand: wfBand.id, budget: budget.id, vat7: vat7.id, histType: histType.id, histTmpl: histTmpl.id, fy: fy.id });
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
      undefined, undefined, undefined, undefined, undefined, undefined,
      // The period guard is optional on the service; supplying it here is what makes the
      // closed-period case a test of the guard rather than of its absence.
      new PeriodGuardService(),
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

  it('computes VAT and charges it to the budget along with the net amount', async () => {
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
    // Both bases are tax-inclusive now. They flipped from net deliberately: the premise that input
    // VAT is reclaimed — and so is not the department's cost — does not hold for this company, and a
    // budget charged the net figure reported room the tax had already spent. The two bases differ by
    // the RATE and by nothing else, which is what keeps an FX difference an FX difference.
    expect(Number(reloaded.budgetBaseTotalAmount)).toBe(1070);
    expect(Number(await budgetBalance.outstandingReserved(doc.id, ids.budget))).toBe(1070);
    expect(Number(line.budgetBaseLineAmount)).toBe(1070);
    expect(Number(line.taxAmount)).toBe(70);
  });

  it('charges an untaxed line exactly what it charged before', async () => {
    // The case that makes ONE rule cover both. A line naming no tax code adds nothing to its own
    // budget base, so nothing about it changes — which is why taxed and untaxed lines need no
    // second setting to keep in step with the first.
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
      budget: em.getReference(Budget, ids.budget),
    });
    await em.flush();

    await asCtx(() => submit.submit(doc.id));
    const reloaded = await reload(doc.id);
    expect(Number(reloaded.taxTotal)).toBe(0);
    expect(Number(reloaded.budgetBaseTotalAmount)).toBe(1000);
    expect(Number(await budgetBalance.outstandingReserved(doc.id, ids.budget))).toBe(1000);
  });

  it('charges each line for its own tax on a mixed document', async () => {
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
      status: DocStatus.DRAFT, createdAt: new Date(),
    });
    em.create(DocumentLine, {
      document: doc, lineNo: 1, description: 'taxed', qty: '1', unitPrice: '1000', lineAmount: '1000',
      taxCode: em.getReference(TaxCode, ids.vat7), budget: em.getReference(Budget, ids.budget),
    });
    em.create(DocumentLine, {
      document: doc, lineNo: 2, description: 'untaxed', qty: '1', unitPrice: '500', lineAmount: '500',
      budget: em.getReference(Budget, ids.budget),
    });
    await em.flush();

    await asCtx(() => submit.submit(doc.id));
    const fork = orm.em.fork();
    const l1 = await fork.findOneOrFail(DocumentLine, { document: doc.id, lineNo: 1 }, FILTER_OFF);
    const l2 = await fork.findOneOrFail(DocumentLine, { document: doc.id, lineNo: 2 }, FILTER_OFF);
    expect(Number(l1.budgetBaseLineAmount)).toBe(1070);
    expect(Number(l2.budgetBaseLineAmount)).toBe(500);
    expect(Number(await budgetBalance.outstandingReserved(doc.id, ids.budget))).toBe(1570);
  });

  it('settles a taxed document to zero outstanding, at the base it reserved', async () => {
    // Reserve, actual and release all read the ONE stamped figure, so a taxed document cannot
    // reserve on one basis and settle on another and strand a remainder nobody owns.
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
      status: DocStatus.DRAFT, createdAt: new Date(),
    });
    em.create(DocumentLine, {
      document: doc, lineNo: 1, description: 'X', qty: '1', unitPrice: '1000', lineAmount: '1000',
      taxCode: em.getReference(TaxCode, ids.vat7), budget: em.getReference(Budget, ids.budget),
    });
    await em.flush();

    await asCtx(() => submit.submit(doc.id));
    expect(Number(await budgetBalance.outstandingReserved(doc.id, ids.budget))).toBe(1070);

    const postAction = new PostActionService(budgetLedger, orm.em);
    const settling = await orm.em.fork().findOneOrFail(Document, { id: doc.id }, { ...FILTER_OFF, populate: ['documentType', 'company'] });
    await asCtx(() => orm.em.fork().transactional((tem: EntityManager) => postAction.run(settling, tem)));

    expect(Number(await budgetBalance.outstandingReserved(doc.id, ids.budget))).toBe(0);
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

  it('dates the ledger by the stated day and the trail by the real clock', async () => {
    // The whole point of separating the two: the person says when the money moved, the system says
    // when it was told. If a later hand "helpfully" backdated submitted_at as well, the approval
    // trail would start lying about when anyone actually acted — which is the one thing an audit
    // reads it for.
    const before = new Date();
    const id = await backdatedDraft('2026-03-14', '1000');
    await asCtx(() => submit.submit(id));

    const doc = await reload(id);
    expect(doc.moneyMovedOn).toBe('2026-03-14');
    expect(doc.submittedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());

    const rows = await orm.em.fork().find(BudgetTxn, { document: id }, FILTER_OFF);
    expect(rows.map((r) => r.txnDate)).toEqual(['2026-03-14']);
  });


  it('refuses a day outside the fiscal year of the budget it charges', async () => {
    // The budget belongs to FY2026. A day in 2025 would land its RESERVE in a year the budget does
    // not exist in, where no report would ever count it and no closing would ever catch it.
    const id = await backdatedDraft('2025-12-31', '1000');
    await expect(asCtx(() => submit.submit(id))).rejects.toThrow(/outside fiscal year 2026/);

    const rows = await orm.em.fork().find(BudgetTxn, { document: id }, FILTER_OFF);
    expect(rows).toHaveLength(0);
  });

  it('refuses a day inside a closed accounting period', async () => {
    // Asked through the same PeriodGuardService the general ledger asks, so the two cannot disagree
    // about which days are shut. Without it a backdating feature would reach behind the lock that
    // `accounting-period` exists to hold.
    const em = orm.em.fork();
    em.create(AccountingPeriod, {
      company: em.getReference(Company, ids.company),
      fiscalYear: em.getReference(FiscalYear, ids.fy),
      code: '2026-03',
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
      status: 'CLOSED',
    } as never);
    await em.flush();

    const id = await backdatedDraft('2026-03-14', '1000');
    await expect(asCtx(() => submit.submit(id))).rejects.toThrow(/closed/i);

    const rows = await orm.em.fork().find(BudgetTxn, { document: id }, FILTER_OFF);
    expect(rows).toHaveLength(0);
  });

});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[budget-rate-control] no database reachable — skipping DB-backed spec');
}
