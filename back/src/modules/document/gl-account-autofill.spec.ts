import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachCoverage } from '../../test/budget-fixture';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ControlPolicy, DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { AccountService } from '../accounting/account.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetService } from '../budget/budget.service';
import { Budget } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { ItemService } from '../master-data/item.service';
import { Item, ItemCompany } from '../master-data/master-data.entities';
import { VendorService } from '../master-data/vendor.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentSubmitService } from './document-submit.service';
import { DeptDocType, Document, DocumentLine, DocumentType, FormTemplate } from './document.entities';
import { DocumentService } from './document.service';
import { NumberingService } from './numbering.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

function asCtx<T>(companyId: string, departmentId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId: GLOBAL.userId, companyId, departmentId, grants: [] }, fn);
}
const GLOBAL = { userId: '' };

/**
 * Item-driven GL + budget resolution: the requester picks the item; the server derives the
 * line's GL from the item and resolves the budget from (fiscal year, department, GL).
 */
describe.skipIf(!hasDb)('GL account + budget autofill (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  let submit: DocumentSubmitService;
  let budgets: BudgetService;

  const ids = {
    companyA: '', deptA: '', companyB: '', deptB: '',
    dtBudget: '', dtPlain: '',
    fyA: '', fyB: '',
    budgetElec: '', budgetElecB: '',
    itemElec: '', itemNoGl: '', itemNoBudget: '',
  };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });

    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const companyB = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'DA', isActive: true });
    const deptB = em.create(Department, { company: companyB, deptCode: 'DB', name: 'DB', isActive: true });
    // A fiscal year covering "today" so the document date resolves to it.
    const y = new Date().getUTCFullYear();
    const fyA = em.create(FiscalYear, { company: companyA, year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'OPEN' });
    const fyB = em.create(FiscalYear, { company: companyB, year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'OPEN' });
    const wfA = em.create(Workflow, { company: companyA, name: 'WFA', isActive: true });
    const wfB = em.create(Workflow, { company: companyB, name: 'WFB', isActive: true });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });

    const dtBudget = em.create(DocumentType, { company: companyA, code: 'PR', name: 'PR', category: DocCategory.PROCUREMENT, requiresBudget: true, requiresQuota: false, isActive: true });
    const dtPlain = em.create(DocumentType, { company: companyA, code: 'MEMO', name: 'Memo', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, isActive: true });
    const tmplBudget = em.create(FormTemplate, { documentType: dtBudget, version: 1, status: 'PUBLISHED' });
    const tmplPlain = em.create(FormTemplate, { documentType: dtPlain, version: 1, status: 'PUBLISHED' });
    em.create(DeptDocType, { department: deptA, documentType: dtBudget, formTemplate: tmplBudget, workflow: wfA, isActive: true });
    em.create(DeptDocType, { department: deptA, documentType: dtPlain, formTemplate: tmplPlain, workflow: wfA, isActive: true });
    em.create(DeptDocType, { department: deptB, documentType: dtBudget, formTemplate: tmplBudget, workflow: wfB, isActive: true });

    // Budget for GL 5210 (electricity) in company A + a same-GL budget in company B (must never
    // be resolved from company A).
    const budgetElec = em.create(Budget, { fiscalYear: fyA, department: deptA, glAccount: '5210', budgetName: 'Utilities A', amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    attachCoverage(em, companyA, budgetElec);
    const budgetElecB = em.create(Budget, { fiscalYear: fyB, department: deptB, glAccount: '5210', budgetName: 'Utilities B', amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    attachCoverage(em, companyB, budgetElecB);

    // Items: electricity (GL 5210, has budget), a GL-less item, and an item whose GL has no
    // budget. All enabled for company A — the GL lives on the per-company item_company row.
    const itemElec = em.create(Item, { itemCode: 'ELEC', name: 'Electricity', isStockTracked: false, isActive: true });
    const itemNoGl = em.create(Item, { itemCode: 'NOGL', name: 'No GL item', isStockTracked: false, isActive: true });
    const itemNoBudget = em.create(Item, { itemCode: 'NOBUD', name: 'GL without budget', isStockTracked: false, isActive: true });
    em.create(ItemCompany, { item: itemElec, company: companyA, isActive: true, defaultGlAccount: '5210' });
    em.create(ItemCompany, { item: itemNoGl, company: companyA, isActive: true });
    em.create(ItemCompany, { item: itemNoBudget, company: companyA, isActive: true, defaultGlAccount: '5999' });

    await em.flush();
    GLOBAL.userId = user.id;
    Object.assign(ids, {
      companyA: companyA.id, deptA: deptA.id, companyB: companyB.id, deptB: deptB.id,
      dtBudget: dtBudget.id, dtPlain: dtPlain.id,
      fyA: fyA.id, fyB: fyB.id,
      budgetElec: budgetElec.id, budgetElecB: budgetElecB.id,
      itemElec: itemElec.id, itemNoGl: itemNoGl.id, itemNoBudget: itemNoBudget.id,
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
    const itemService = new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope));
    const vendorService = new VendorService(orm.em, scope, new ScopeService());
    budgets = new BudgetService(orm.em, new AccountService(orm.em, scope), new BudgetBalanceService(orm.em));
    const fiscalYears = new FiscalYearService(scope);
    documents = new DocumentService(orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em), itemService, budgets, fiscalYears);
    const budgetBal = new BudgetBalanceService(orm.em);
    submit = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      fiscalYears,
      vendorService,
      itemService,
      new BudgetLedgerService(orm.em, budgetBal, new BudgetCoverageService(orm.em)),
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
  });

  const lineOf = async (documentId: string) =>
    (await orm.em.fork().find(DocumentLine, { document: documentId }, { filters: { company: false }, populate: ['budget'] }))[0];

  // ---- Budget resolve read (task 1) ------------------------------------------

  it('resolves the unique active budget for a GL/department/fiscal-year triple', async () => {
    const r = await asCtx(ids.companyA, ids.deptA, () =>
      budgets.resolveSelectable({ glAccount: '5210', departmentId: ids.deptA, fiscalYearId: ids.fyA }),
    );
    expect(r?.id).toBe(ids.budgetElec);
    expect(Object.keys(r!).sort()).toEqual(['budgetName', 'glAccount', 'id']);
  });

  it('returns null when no active budget matches the triple', async () => {
    const r = await asCtx(ids.companyA, ids.deptA, () =>
      budgets.resolveSelectable({ glAccount: '9999', departmentId: ids.deptA, fiscalYearId: ids.fyA }),
    );
    expect(r).toBeNull();
  });

  it('never resolves another company budget (company-scoped)', async () => {
    // Company A active, but ask for company B's fiscal year / department → no leak.
    const r = await asCtx(ids.companyA, ids.deptA, () =>
      budgets.resolveSelectable({ glAccount: '5210', departmentId: ids.deptB, fiscalYearId: ids.fyB }),
    );
    expect(r).toBeNull();
  });

  // ---- Item-driven derivation (task 2) ---------------------------------------

  it('derives the line GL from the item and resolves the budget', async () => {
    const doc = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId: ids.dtBudget,
        lines: [{ lineNo: 1, itemId: ids.itemElec, description: 'Electricity July', qty: '1', unitPrice: '5000', lineAmount: '5000' }],
      }),
    );
    const line = await lineOf(doc.id);
    expect(line.glAccount).toBe('5210');
    expect(line.budget?.id).toBe(ids.budgetElec);
  });

  it('rejects an item-backed line whose item has no default GL on a budget-controlled type', async () => {
    await expect(
      asCtx(ids.companyA, ids.deptA, () =>
        documents.createDraft({
          documentTypeId: ids.dtBudget,
          lines: [{ lineNo: 1, itemId: ids.itemNoGl, description: 'x', qty: '1', unitPrice: '10', lineAmount: '10' }],
        }),
      ),
    ).rejects.toThrow(/no default GL/i);
  });

  it('rejects when the item GL has no active budget', async () => {
    await expect(
      asCtx(ids.companyA, ids.deptA, () =>
        documents.createDraft({
          documentTypeId: ids.dtBudget,
          lines: [{ lineNo: 1, itemId: ids.itemNoBudget, description: 'x', qty: '1', unitPrice: '10', lineAmount: '10' }],
        }),
      ),
    ).rejects.toThrow(/No active budget/i);
  });

  it('item-less line uses the explicit budget and rides its GL', async () => {
    const doc = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId: ids.dtBudget,
        lines: [{ lineNo: 1, description: 'free-text utilities', qty: '1', unitPrice: '300', lineAmount: '300', budgetId: ids.budgetElec }],
      }),
    );
    const line = await lineOf(doc.id);
    expect(line.budget?.id).toBe(ids.budgetElec);
    expect(line.glAccount).toBe('5210');
  });

  it('derives GL from the item but resolves no budget on a non-budget type', async () => {
    const doc = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId: ids.dtPlain,
        lines: [{ lineNo: 1, itemId: ids.itemElec, description: 'info only', qty: '1', unitPrice: '0', lineAmount: '0' }],
      }),
    );
    const line = await lineOf(doc.id);
    expect(line.glAccount).toBe('5210');
    expect(line.budget).toBeNull();
  });

  // ---- Submit re-validation (task 2.8) ---------------------------------------

  it('rejects submit when the resolved budget was deactivated after draft, leaving it DRAFT', async () => {
    const doc = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId: ids.dtBudget,
        lines: [{ lineNo: 1, itemId: ids.itemElec, description: 'Electricity', qty: '1', unitPrice: '5000', lineAmount: '5000' }],
      }),
    );
    // Deactivate the budget between draft and submit.
    const em = orm.em.fork();
    const b = await em.findOneOrFail(Budget, { id: ids.budgetElec }, { filters: { company: false } });
    b.status = 'INACTIVE';
    await em.flush();

    await expect(asCtx(ids.companyA, ids.deptA, () => submit.submit(doc.id))).rejects.toThrow(/inactive budget/i);
    const reread = await orm.em.fork().findOneOrFail(Document, { id: doc.id }, { filters: { company: false } });
    expect(reread.status).toBe(DocStatus.DRAFT);

    // Restore for any later tests sharing the budget.
    const em2 = orm.em.fork();
    const b2 = await em2.findOneOrFail(Budget, { id: ids.budgetElec }, { filters: { company: false } });
    b2.status = 'ACTIVE';
    await em2.flush();
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[gl-account-autofill] no database reachable — skipping DB-backed spec');
}
