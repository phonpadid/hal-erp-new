import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { BudgetTxnType, ControlPolicy, DocCategory, DocStatus, TaxKind } from '../../common/enums';
import { Money } from '../../common/money/money';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { AccountService } from '../accounting/account.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetService } from '../budget/budget.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { ItemService } from '../master-data/item.service';
import { VendorService } from '../master-data/vendor.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { TaxCode } from '../tax/tax.entities';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentSubmitService } from './document-submit.service';
import {
  DeptDocType,
  Document,
  DocumentLine,
  DocumentType,
  DocumentTypeRef,
  FormTemplate,
} from './document.entities';
import { DocumentService } from './document.service';
import { NumberingService } from './numbering.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

const GLOBAL = { userId: '' };
function asCtx<T>(companyId: string, departmentId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId: GLOBAL.userId, companyId, departmentId, grants: [] }, fn);
}

/**
 * One budget hold per reference chain (PROC→PO→DISB). A successor copies the predecessor's
 * budgeted lines, but only ONE reservation in the chain is ever settled — so a successor that
 * reserved again would strand the predecessor's RESERVE forever.
 */
describe.skipIf(!hasDb)('ref-chain budget reservation (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  let submit: DocumentSubmitService;
  let ledger: BudgetLedgerService;

  const ids = { company: '', dept: '', dtPr: '', dtDisb: '', budget: '', vat: '' };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, { code: 'C', nameTh: 'C', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const dept = em.create(Department, { company, deptCode: 'D', name: 'D', isActive: true });
    const y = new Date().getUTCFullYear();
    const fy = em.create(FiscalYear, { company, year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'OPEN' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });

    // Both types are budget-controlled, exactly as the seeded PROC and DISB are: the successor
    // reserving a second time is what this suite pins down.
    const dtPr = em.create(DocumentType, { company, code: 'PR', name: 'PR', category: DocCategory.PROCUREMENT, requiresBudget: true, requiresQuota: false, isActive: true });
    const dtDisb = em.create(DocumentType, { company, code: 'DISB', name: 'DISB', category: DocCategory.FINANCE, requiresBudget: true, requiresQuota: false, postAction: 'CUT_BUDGET', isActive: true });
    const tmplPr = em.create(FormTemplate, { documentType: dtPr, version: 1, status: 'PUBLISHED' });
    const tmplDisb = em.create(FormTemplate, { documentType: dtDisb, version: 1, status: 'PUBLISHED' });
    em.create(DeptDocType, { department: dept, documentType: dtPr, formTemplate: tmplPr, workflow: wf, isActive: true });
    em.create(DeptDocType, { department: dept, documentType: dtDisb, formTemplate: tmplDisb, workflow: wf, isActive: true });
    em.create(DocumentTypeRef, { company, predecessorType: dtPr, successorType: dtDisb, autoCreate: false });

    const budget = budgetAt(em, { fiscalYear: fy, department: dept, code: '5000', glAccount: '5000', budgetName: 'Office', amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    attachCoverage(em, company, budget);
    const vat = em.create(TaxCode, { company, code: 'VAT7', name: 'VAT 7%', kind: TaxKind.VAT, rate: '0.070000', isActive: true });

    await em.flush();
    GLOBAL.userId = user.id;
    Object.assign(ids, {
      company: company.id, dept: dept.id,
      dtPr: dtPr.id, dtDisb: dtDisb.id,
      budget: budget.id, vat: vat.id,
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
    const budgetService = new BudgetService(orm.em, new AccountService(orm.em, scope), new BudgetBalanceService(orm.em));
    const fiscalYears = new FiscalYearService(scope);
    ledger = new BudgetLedgerService(orm.em, new BudgetBalanceService(orm.em), new BudgetCoverageService(orm.em));
    documents = new DocumentService(orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em), itemService, budgetService, fiscalYears);
    submit = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      fiscalYears,
      vendorService,
      itemService,
      ledger,
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
  });

  const txns = (documentId: string) => orm.em.fork().find(BudgetTxn, { document: documentId }, FILTER_OFF);
  const reserves = async (documentId: string) =>
    (await txns(documentId)).filter((t) => t.txnType === BudgetTxnType.RESERVE);

  /** A submitted predecessor holding a reservation, marked COMPLETED so it can be created from. */
  async function completedPredecessor(amount = '50000', taxCodeId?: string): Promise<string> {
    const id = await asCtx(ids.company, ids.dept, async () => {
      const d = await documents.createDraft({
        documentTypeId: ids.dtPr,
        lines: [{ lineNo: 1, description: 'A4 paper', qty: '1', unitPrice: amount, lineAmount: amount, budgetId: ids.budget, taxCodeId }],
      });
      await submit.submit(d.id);
      return d.id;
    });
    const em = orm.em.fork();
    const doc = await em.findOneOrFail(Document, { id }, FILTER_OFF);
    doc.status = DocStatus.COMPLETED;
    await em.flush();
    return id;
  }

  it('does not reserve again for a budget its predecessor is still holding', async () => {
    const prId = await completedPredecessor();
    expect(await reserves(prId)).toHaveLength(1);

    const disb = await asCtx(ids.company, ids.dept, async () => {
      const d = await documents.createFrom(prId, ids.dtDisb);
      return submit.submit(d.id);
    });

    expect(disb.status).toBe(DocStatus.SUBMITTED);
    expect(await reserves(disb.id)).toHaveLength(0); // the chain's hold is the predecessor's
    const held = await orm.em.fork().find(BudgetTxn, { budget: ids.budget }, FILTER_OFF);
    expect(held.filter((t) => t.txnType === BudgetTxnType.RESERVE)).toHaveLength(1);
  });

  it('settles the whole chain with no reservation left stranded', async () => {
    const balanceBefore = await new BudgetBalanceService(orm.em).availableBalance(ids.budget);
    const prId = await completedPredecessor('40000');
    const disbId = await asCtx(ids.company, ids.dept, async () => {
      const d = await documents.createFrom(prId, ids.dtDisb);
      await submit.submit(d.id);
      return d.id;
    });

    // What PostActionService.cutBudget does on approval: settle the chain's reserving document.
    await ledger.settle(prId, ids.budget, '40000');

    const balance = new BudgetBalanceService(orm.em);
    expect(await balance.outstandingReserved(prId, ids.budget)).toBe('0');
    expect(await balance.outstandingReserved(disbId, ids.budget)).toBe('0');
    // The chain costs the budget 40,000 once — not 80,000 with half of it stranded as RESERVE.
    expect(await balance.availableBalance(ids.budget)).toBe(Money.subtract(balanceBefore, '40000'));
  });

  it('takes its own hold when the predecessor has already been settled', async () => {
    const prId = await completedPredecessor('30000');
    await ledger.settle(prId, ids.budget, '30000'); // predecessor now holds nothing

    const disb = await asCtx(ids.company, ids.dept, async () => {
      const d = await documents.createFrom(prId, ids.dtDisb);
      return submit.submit(d.id);
    });

    expect(await reserves(disb.id)).toHaveLength(1);
  });

  it('reserves normally for a document with no predecessor', async () => {
    const id = await asCtx(ids.company, ids.dept, async () => {
      const d = await documents.createDraft({
        documentTypeId: ids.dtDisb,
        lines: [{ lineNo: 1, description: 'standalone', qty: '1', unitPrice: '10000', lineAmount: '10000', budgetId: ids.budget }],
      });
      await submit.submit(d.id);
      return d.id;
    });
    expect(await reserves(id)).toHaveLength(1);
  });

  it('serializes a successor submit against a concurrent settle of the hold it would skip', async () => {
    // The window the budget lock closes: the successor reads "my ancestor holds this budget" while
    // that very hold is being settled. Whichever order the two commit in, the chain must end up
    // with exactly one accounting of the money — never a skipped reserve backed by a hold that is
    // no longer there, and never two live holds.
    const balance = new BudgetBalanceService(orm.em);
    const balanceBefore = await balance.availableBalance(ids.budget);
    const prId = await completedPredecessor('25000');
    const disbId = await asCtx(ids.company, ids.dept, async () => {
      const d = await documents.createFrom(prId, ids.dtDisb);
      return d.id;
    });

    // Head start so the submit takes the budget lock first; the settle then has to wait for it to
    // commit instead of releasing the hold out from under the check.
    const results = await Promise.allSettled([
      asCtx(ids.company, ids.dept, () => submit.submit(disbId)),
      new Promise((r) => setTimeout(r, 100)).then(() => ledger.settle(prId, ids.budget, '25000')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2); // neither is rejected

    const prOutstanding = await balance.outstandingReserved(prId, ids.budget);
    const disbOutstanding = await balance.outstandingReserved(disbId, ids.budget);

    // Never two live holds for one spend — the defect this change fixes.
    expect(Money.compare(prOutstanding, '0') > 0 && Money.compare(disbOutstanding, '0') > 0).toBe(false);
    // Submit went first, so the successor skipped and the settle converted the predecessor's hold.
    expect(await reserves(disbId)).toHaveLength(0);
    expect((await txns(prId)).filter((t) => t.txnType === BudgetTxnType.ACTUAL)).toHaveLength(1);
    // One spend, charged once, whichever way the two transactions interleaved.
    expect(await balance.availableBalance(ids.budget)).toBe(Money.subtract(balanceBefore, '25000'));
  });

  it('makes a claiming document name its tax invoice, and lets a commitment estimate without one', async () => {
    // The PR carries a tax code to ESTIMATE what the purchase will cost, and submits fine: nobody
    // has the supplier's invoice when raising a requisition. The disbursement IS the accepted
    // invoice, so once its type recognises the expense at approval it has to name one.
    const prId = await completedPredecessor('20000', ids.vat); // a commitment, submitted with tax
    const disb = await asCtx(ids.company, ids.dept, () => documents.createFrom(prId, ids.dtDisb));

    const em = orm.em.fork();
    const dt = await em.findOneOrFail(DocumentType, { id: ids.dtDisb }, FILTER_OFF);
    dt.accruesOnApproval = true;
    await em.flush();
    try {
      await expect(
        asCtx(ids.company, ids.dept, () => submit.submit(disb.id)),
      ).rejects.toThrow(/supplier invoice number/i);

      // The number alone is not enough — the DATE is the tax point.
      await asCtx(ids.company, ids.dept, () => documents.setVendorInvoice(disb.id, 'SUP-77', null));
      await expect(
        asCtx(ids.company, ids.dept, () => submit.submit(disb.id)),
      ).rejects.toThrow(/supplier invoice date/i);

      await asCtx(ids.company, ids.dept, () => documents.setVendorInvoice(disb.id, 'SUP-77', '2026-03-04'));
      const ok = await asCtx(ids.company, ids.dept, () => submit.submit(disb.id));
      expect(ok.vendorInvoiceNo).toBe('SUP-77');
      expect(ok.vendorInvoiceDate).toBe('2026-03-04');
    } finally {
      const back = orm.em.fork();
      const t = await back.findOneOrFail(DocumentType, { id: ids.dtDisb }, FILTER_OFF);
      t.accruesOnApproval = false;
      await back.flush();
    }
  });

  it('carries the predecessor line tax code onto the successor', async () => {
    const prId = await completedPredecessor('20000', ids.vat);
    const disb = await asCtx(ids.company, ids.dept, () => documents.createFrom(prId, ids.dtDisb));

    const lines = await orm.em.fork().find(DocumentLine, { document: disb.id }, { ...FILTER_OFF, populate: ['taxCode'] });
    expect(lines[0].taxCode?.id).toBe(ids.vat);

    // …so the successor's totals match the predecessor's instead of silently losing the VAT.
    const submitted = await asCtx(ids.company, ids.dept, () => submit.submit(disb.id));
    expect(submitted.taxTotal).toBe('1400.00');
    expect(submitted.grandTotal).toBe('21400.00');
  });
});
