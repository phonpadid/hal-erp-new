import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
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
 * The two halves of a line, resolved independently: the server derives the GL from the item, and
 * the budget is whichever one the requester named. Neither derives the other.
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
    budgetElec: '', budgetOther: '', budgetNoGl: '', budgetInactive: '', budgetElecB: '',
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
    const budgetElec = budgetAt(em, { fiscalYear: fyA, department: deptA, code: '5210', glAccount: '5210', budgetName: 'Utilities A', amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    attachCoverage(em, companyA, budgetElec);
    // A SECOND budget in the same department. It records a different account, so a test can show
    // that naming it does not move the line's GL — the direction the old chain ran in.
    const budgetOther = budgetAt(em, { fiscalYear: fyA, department: deptA, code: '5300', glAccount: '5300', budgetName: 'Repairs A', amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    attachCoverage(em, companyA, budgetOther);
    // A budget that records NO account: its spending posts to several, so naming one would be
    // false. And an INACTIVE one, which a line may not charge at all.
    const budgetNoGl = budgetAt(em, { fiscalYear: fyA, department: deptA, code: '9.9', budgetName: 'Vehicle instalments', amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    attachCoverage(em, companyA, budgetNoGl);
    const budgetInactive = budgetAt(em, { fiscalYear: fyA, department: deptA, code: '9.8', glAccount: '5210', budgetName: 'Closed line', amountTotal: '1000', controlPolicy: ControlPolicy.HARD_STOP, status: 'INACTIVE' });
    const budgetElecB = budgetAt(em, { fiscalYear: fyB, department: deptB, code: '5210', glAccount: '5210', budgetName: 'Utilities B', amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
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
      budgetElec: budgetElec.id, budgetOther: budgetOther.id, budgetNoGl: budgetNoGl.id,
      budgetInactive: budgetInactive.id, budgetElecB: budgetElecB.id,
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

  // ---- The GL comes from the item. The budget comes from the requester. ------------------
  //
  // These were one chain until the customer's books disproved it: `item → GL → budget` assumed an
  // account named exactly one budget, and a single voucher of theirs posts thirteen lines to
  // account 658.0007 across fuel, repairs and registration budgets in one department. The tests
  // that exercised the resolve-by-GL read are gone with the read; what replaces them asserts the
  // two facts stay INDEPENDENT, which is the property the old chain cannot express.

  it('derives the line GL from the item and takes the budget the requester named', async () => {
    const doc = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId: ids.dtBudget,
        lines: [{ lineNo: 1, itemId: ids.itemElec, description: 'Electricity July', qty: '1', unitPrice: '5000', lineAmount: '5000', budgetId: ids.budgetElec }],
      }),
    );
    const line = await lineOf(doc.id);
    expect(line.glAccount).toBe('5210');
    expect(line.budget?.id).toBe(ids.budgetElec);
  });

  it('leaves the derived GL alone when the named budget records a different one', async () => {
    // The inversion, stated as an assertion: choosing a budget used to stamp the line's account.
    const doc = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId: ids.dtBudget,
        lines: [{ lineNo: 1, itemId: ids.itemElec, description: 'x', qty: '1', unitPrice: '10', lineAmount: '10', budgetId: ids.budgetOther }],
      }),
    );
    const line = await lineOf(doc.id);
    expect(line.glAccount).toBe('5210');
    expect(line.budget?.id).toBe(ids.budgetOther);
  });

  it('lets two lines on one account charge two different budgets', async () => {
    // The shape the old chain could not express at all, and the reason this change exists.
    const doc = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId: ids.dtBudget,
        lines: [
          { lineNo: 1, itemId: ids.itemElec, description: 'a', qty: '1', unitPrice: '10', lineAmount: '10', budgetId: ids.budgetElec },
          { lineNo: 2, itemId: ids.itemElec, description: 'b', qty: '1', unitPrice: '10', lineAmount: '10', budgetId: ids.budgetOther },
        ],
      }),
    );
    const lines = await orm.em.fork().find(
      DocumentLine,
      { document: doc.id },
      { filters: { company: false }, populate: ['budget'], orderBy: { lineNo: 'ASC' } },
    );
    expect(lines.map((l) => l.glAccount)).toEqual(['5210', '5210']);
    expect(lines.map((l) => l.budget?.id)).toEqual([ids.budgetElec, ids.budgetOther]);
  });

  it('rejects an item-backed line whose item has no default GL on a budget-controlled type', async () => {
    await expect(
      asCtx(ids.companyA, ids.deptA, () =>
        documents.createDraft({
          documentTypeId: ids.dtBudget,
          lines: [{ lineNo: 1, itemId: ids.itemNoGl, description: 'x', qty: '1', unitPrice: '10', lineAmount: '10', budgetId: ids.budgetElec }],
        }),
      ),
    ).rejects.toThrow(/no default GL/i);
  });

  it('refuses a budget belonging to another company', async () => {
    // What used to be "never resolves another company budget": the scoping moved from the read to
    // the line, because the line is where a budget is now named.
    await expect(
      asCtx(ids.companyA, ids.deptA, () =>
        documents.createDraft({
          documentTypeId: ids.dtBudget,
          lines: [{ lineNo: 1, itemId: ids.itemElec, description: 'x', qty: '1', unitPrice: '10', lineAmount: '10', budgetId: ids.budgetElecB }],
        }),
      ),
    ).rejects.toThrow(/does not exist in this company/i);
  });

  it('item-less line rides the named budget\'s GL when the type sets no default', async () => {
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

  it('derives GL from the item and carries no budget on a non-budget type', async () => {
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

  it('refuses a budget that is not ACTIVE', async () => {
    await expect(
      asCtx(ids.companyA, ids.deptA, () =>
        documents.createDraft({
          documentTypeId: ids.dtBudget,
          lines: [{ lineNo: 1, itemId: ids.itemElec, description: 'x', qty: '1', unitPrice: '10', lineAmount: '10', budgetId: ids.budgetInactive }],
        }),
      ),
    ).rejects.toThrow(/is INACTIVE, not ACTIVE/i);
  });

  it('leaves an item-less line with no GL when nothing supplies one, and does not reject it', async () => {
    // The end of the precedence chain: no item, no type default, and a budget that records no
    // account because its spending posts to several. A line with no GL is incomplete, not invalid
    // — the accounting that needs one is done later, and refusing the draft here would make a
    // legitimate budget unusable.
    const doc = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId: ids.dtBudget,
        lines: [{ lineNo: 1, description: 'instalment 06/26', qty: '1', unitPrice: '900', lineAmount: '900', budgetId: ids.budgetNoGl }],
      }),
    );
    const line = await lineOf(doc.id);
    expect(line.budget?.id).toBe(ids.budgetNoGl);
    expect(line.glAccount ?? null).toBeNull();
  });

  it('accepts an item whose account has no budget of its own', async () => {
    // This threw before: the account was asked to name a budget and could not. Nothing asks it now.
    const doc = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId: ids.dtBudget,
        lines: [{ lineNo: 1, itemId: ids.itemNoBudget, description: 'x', qty: '1', unitPrice: '10', lineAmount: '10', budgetId: ids.budgetElec }],
      }),
    );
    const line = await lineOf(doc.id);
    expect(line.glAccount).toBe('5999');
    expect(line.budget?.id).toBe(ids.budgetElec);
  });

  // ---- Submit re-validation (task 2.8) ---------------------------------------

  it('rejects submit when the resolved budget was deactivated after draft, leaving it DRAFT', async () => {
    const doc = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId: ids.dtBudget,
        lines: [{ lineNo: 1, itemId: ids.itemElec, description: 'Electricity', qty: '1', unitPrice: '5000', lineAmount: '5000', budgetId: ids.budgetElec }],
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
