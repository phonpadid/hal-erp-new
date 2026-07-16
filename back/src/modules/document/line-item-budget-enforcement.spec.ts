import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { BudgetTxnType, ControlPolicy, DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { AccountService } from '../accounting/account.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetService } from '../budget/budget.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
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
import { DocumentTypeService } from './document-type.service';
import { DeptDocType, Document, DocumentCategory, DocumentLine, DocumentType, FormTemplate } from './document.entities';
import { DocumentService } from './document.service';
import { NumberingService } from './numbering.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

function asCtx<T>(companyId: string, departmentId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId: GLOBAL.userId, companyId, departmentId, grants: [] }, fn);
}
const GLOBAL = { userId: '' };

/** requires_item enforcement + complete per-line budget coverage at submit. */
describe.skipIf(!hasDb)('line item + budget enforcement (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  let submit: DocumentSubmitService;

  const ids = {
    companyA: '', deptA: '',
    dtItemReq: '', dtBudget: '',
    budgetElec: '', itemElec: '',
  };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'DA', isActive: true });
    const y = new Date().getUTCFullYear();
    const fyA = em.create(FiscalYear, { company: companyA, year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'OPEN' });
    const wfA = em.create(Workflow, { company: companyA, name: 'WFA', isActive: true });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });

    // requiresItem type (no budget, to isolate the item rule); requiresBudget type.
    const dtItemReq = em.create(DocumentType, { company: companyA, code: 'PRI', name: 'PR-Item', category: DocCategory.PROCUREMENT, requiresBudget: false, requiresQuota: false, requiresItem: true, isActive: true });
    const dtBudget = em.create(DocumentType, { company: companyA, code: 'PR', name: 'PR', category: DocCategory.PROCUREMENT, requiresBudget: true, requiresQuota: false, isActive: true });
    const tmplItemReq = em.create(FormTemplate, { documentType: dtItemReq, version: 1, status: 'PUBLISHED' });
    const tmplBudget = em.create(FormTemplate, { documentType: dtBudget, version: 1, status: 'PUBLISHED' });
    em.create(DeptDocType, { department: deptA, documentType: dtItemReq, formTemplate: tmplItemReq, workflow: wfA, isActive: true });
    em.create(DeptDocType, { department: deptA, documentType: dtBudget, formTemplate: tmplBudget, workflow: wfA, isActive: true });

    const budgetElec = em.create(Budget, { fiscalYear: fyA, department: deptA, glAccount: '5210', budgetName: 'Utilities', amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    const itemElec = em.create(Item, { itemCode: 'ELEC', name: 'Electricity', isActive: true });
    em.create(ItemCompany, { item: itemElec, company: companyA, isActive: true, defaultGlAccount: '5210' });

    await em.flush();
    GLOBAL.userId = user.id;
    Object.assign(ids, {
      companyA: companyA.id, deptA: deptA.id,
      dtItemReq: dtItemReq.id, dtBudget: dtBudget.id,
      budgetElec: budgetElec.id, itemElec: itemElec.id,
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
    const budgetService = new BudgetService(orm.em, new AccountService(orm.em, scope));
    const fiscalYears = new FiscalYearService(scope);
    documents = new DocumentService(orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em), itemService, budgetService, fiscalYears);
    submit = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      fiscalYears,
      vendorService,
      itemService,
      new BudgetLedgerService(orm.em, new BudgetBalanceService(orm.em)),
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
  });

  const reload = (id: string) => orm.em.fork().findOneOrFail(Document, { id }, { filters: { company: false } });
  const budgetTxns = (id: string) => orm.em.fork().find(BudgetTxn, { document: id }, { filters: { company: false } });

  // ---- requires_item (task 3.1) ----------------------------------------------

  it('rejects submit of an item-less line on a requires_item type, leaving it DRAFT', async () => {
    const { id } = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId: ids.dtItemReq,
        lines: [{ lineNo: 1, description: 'free text', qty: '1', unitPrice: '10', lineAmount: '10' }],
      }),
    );
    await expect(asCtx(ids.companyA, ids.deptA, () => submit.submit(id))).rejects.toThrow(/requires an item/i);
    expect((await reload(id)).status).toBe(DocStatus.DRAFT);
  });

  it('accepts submit when every line carries an item on a requires_item type', async () => {
    const doc = await asCtx(ids.companyA, ids.deptA, async () => {
      const d = await documents.createDraft({
        documentTypeId: ids.dtItemReq,
        lines: [{ lineNo: 1, itemId: ids.itemElec, description: 'Electricity', qty: '1', unitPrice: '10', lineAmount: '10' }],
      });
      return submit.submit(d.id);
    });
    expect(doc.status).toBe(DocStatus.SUBMITTED);
  });

  it('lets a draft hold an item-less line (only submit enforces the item rule)', async () => {
    const { id } = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId: ids.dtItemReq,
        lines: [{ lineNo: 1, description: 'draft in progress', qty: '1', unitPrice: '10', lineAmount: '10' }],
      }),
    );
    // The draft was saved (no throw at createDraft); enforcement is at submit only.
    const rows = await orm.em.fork().find(DocumentLine, { document: id }, { filters: { company: false } });
    expect(rows).toHaveLength(1);
  });

  // ---- complete budget coverage (task 3.2 / 3.3) -----------------------------

  it('rejects a positive-amount line with no budget on a requires_budget type', async () => {
    const { id } = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({
        documentTypeId: ids.dtBudget,
        lines: [
          { lineNo: 1, itemId: ids.itemElec, description: 'covered', qty: '1', unitPrice: '100', lineAmount: '100' },
          { lineNo: 2, description: 'uncovered free text', qty: '1', unitPrice: '50', lineAmount: '50' },
        ],
      }),
    );
    await expect(asCtx(ids.companyA, ids.deptA, () => submit.submit(id))).rejects.toThrow(/no budget/i);
    expect((await reload(id)).status).toBe(DocStatus.DRAFT);
    expect(await budgetTxns(id)).toHaveLength(0); // no hold taken on rejection
  });

  it('allows a zero-amount budget-less line alongside covered positive lines', async () => {
    const doc = await asCtx(ids.companyA, ids.deptA, async () => {
      const d = await documents.createDraft({
        documentTypeId: ids.dtBudget,
        lines: [
          { lineNo: 1, itemId: ids.itemElec, description: 'Electricity', qty: '1', unitPrice: '100', lineAmount: '100' },
          { lineNo: 2, description: 'note (zero amount)', qty: '1', unitPrice: '0', lineAmount: '0' },
        ],
      });
      return submit.submit(d.id);
    });
    expect(doc.status).toBe(DocStatus.SUBMITTED);
    const reserves = (await budgetTxns(doc.id)).filter((t) => t.txnType === BudgetTxnType.RESERVE);
    expect(reserves).toHaveLength(1); // only the positive line reserves
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[line-item-budget-enforcement] no database reachable — skipping DB-backed spec');
}

// --- Document-type config round-trips requiresItem (task 2.3) -----------------
describe.skipIf(!hasDb)('document-type config: requiresItem round-trip', () => {
  let orm: MikroORM;
  let types: DocumentTypeService;
  let companyId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const c = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    // Document-type create validates its category against an active document_category; seed them.
    for (const code of [DocCategory.ADMIN, DocCategory.PROCUREMENT]) {
      em.create(DocumentCategory, { company: c, code, name: code, isActive: true });
    }
    await em.flush();
    companyId = c.id;
    types = new DocumentTypeService(orm.em.fork());
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('defaults requiresItem to false when omitted, and round-trips it on create/update', async () => {
    await RequestContext.run({ userId: 'u', companyId, departmentId: 'd', grants: [] }, async () => {
      const created = await types.create({ code: 'X1', name: 'X', category: DocCategory.ADMIN });
      expect(created.requiresItem).toBe(false);

      const withItem = await types.create({ code: 'X2', name: 'X2', category: DocCategory.PROCUREMENT, requiresItem: true });
      expect(withItem.requiresItem).toBe(true);

      const updated = await types.update(created.id, { requiresItem: true });
      expect(updated.requiresItem).toBe(true);
    });
  });
});
