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
import { Currency, ExchangeRate } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { ItemService } from '../master-data/item.service';
import { VendorService } from '../master-data/vendor.service';
import { Vendor } from '../master-data/master-data.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { Quota, QuotaEntitlement, QuotaUsage } from '../quota/quota.entities';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentSubmitService } from './document-submit.service';
import { DocumentTypeService } from './document-type.service';
import {
  DeptDocType,
  DocFieldValue,
  Document,
  DocumentLine,
  DocumentType,
  FormField,
  FormTemplate,
} from './document.entities';
import { NotFoundException } from '@nestjs/common';
import { DocumentService } from './document.service';
import { FormTemplateService } from './form-template.service';
import { NumberingService } from './numbering.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

function asCtx<T>(companyId: string, departmentId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId: GLOBAL.userId, companyId, departmentId, grants: [] }, fn);
}
const GLOBAL = { userId: '' };

describe.skipIf(!hasDb)('document-engine (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  let submit: DocumentSubmitService;
  let budgetBalance: BudgetBalanceService;

  const ids = {
    companyA: '', deptA: '', companyB: '', deptB: '',
    dtPlain: '', dtBudget: '', dtQuota: '', dtPO: '',
    tmplPlain: '', reasonField: '',
    bA1: '', bA2: '', bB1: '',
    quota: '', employee: '', vendorNotEnabled: '',
  };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    em.create(Currency, { code: 'USD', name: 'Dollar', decimalPlaces: 2, isActive: true });
    em.create(ExchangeRate, { fromCurrency: em.getReference(Currency, 'USD'), toCurrency: thb, rate: '35', rateDate: '2026-01-01', rateType: 'DAILY' });

    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const companyB = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'DA', isActive: true });
    const deptB = em.create(Department, { company: companyB, deptCode: 'DB', name: 'DB', isActive: true });
    const fyA = em.create(FiscalYear, { company: companyA, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const fyB = em.create(FiscalYear, { company: companyB, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'CLOSED' });
    const wfA = em.create(Workflow, { company: companyA, name: 'WFA', isActive: true });
    const wfB = em.create(Workflow, { company: companyB, name: 'WFB', isActive: true });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const employee = em.create(Employee, { company: companyA, department: deptA, empCode: 'E1', fullName: 'E', status: 'ACTIVE' });

    // Document types: plain / budget / quota.
    const dtPlain = em.create(DocumentType, { code: 'MEMO', name: 'Memo', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, isActive: true });
    const dtBudget = em.create(DocumentType, { code: 'PR', name: 'PR', category: DocCategory.PROCUREMENT, requiresBudget: true, requiresQuota: false, isActive: true });
    const dtQuota = em.create(DocumentType, { code: 'LEAVE', name: 'Leave', category: DocCategory.HR, requiresBudget: false, requiresQuota: true, isActive: true });
    // PO is a valid REF_CHAIN successor of PR — used by the reference-chain test.
    const dtPO = em.create(DocumentType, { code: 'PO', name: 'PO', category: DocCategory.PROCUREMENT, requiresBudget: false, requiresQuota: false, isActive: true });
    // requires_vendor type: submit must reject when no vendor is set (config-driven, invariant 7).
    const dtVendorReq = em.create(DocumentType, { code: 'PRV', name: 'PR-Vendor', category: DocCategory.PROCUREMENT, requiresBudget: false, requiresQuota: false, requiresVendor: true, isActive: true });

    const tmplPlain = em.create(FormTemplate, { documentType: dtPlain, version: 1, status: 'PUBLISHED' });
    const reasonField = em.create(FormField, { formTemplate: tmplPlain, fieldName: 'reason', fieldLabel: 'Reason', fieldType: 'text', isRequired: true, sortOrder: 0 });
    const tmplBudget = em.create(FormTemplate, { documentType: dtBudget, version: 1, status: 'PUBLISHED' });
    const tmplQuota = em.create(FormTemplate, { documentType: dtQuota, version: 1, status: 'PUBLISHED' });
    const tmplPO = em.create(FormTemplate, { documentType: dtPO, version: 1, status: 'PUBLISHED' });
    const tmplVendorReq = em.create(FormTemplate, { documentType: dtVendorReq, version: 1, status: 'PUBLISHED' });

    em.create(DeptDocType, { department: deptA, documentType: dtPlain, formTemplate: tmplPlain, workflow: wfA, isActive: true });
    em.create(DeptDocType, { department: deptA, documentType: dtBudget, formTemplate: tmplBudget, workflow: wfA, isActive: true });
    em.create(DeptDocType, { department: deptA, documentType: dtQuota, formTemplate: tmplQuota, workflow: wfA, isActive: true });
    em.create(DeptDocType, { department: deptA, documentType: dtPO, formTemplate: tmplPO, workflow: wfA, isActive: true });
    em.create(DeptDocType, { department: deptA, documentType: dtVendorReq, formTemplate: tmplVendorReq, workflow: wfA, isActive: true });
    em.create(DeptDocType, { department: deptB, documentType: dtBudget, formTemplate: tmplBudget, workflow: wfB, isActive: true });

    const bA1 = em.create(Budget, { fiscalYear: fyA, department: deptA, glAccount: 'GL1', amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    const bA2 = em.create(Budget, { fiscalYear: fyA, department: deptA, glAccount: 'GL2', amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    const bB1 = em.create(Budget, { fiscalYear: fyB, department: deptB, glAccount: 'GL1', amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });

    const quota = em.create(Quota, { company: companyA, quotaType: 'ANNUAL_LEAVE', unit: 'day', limitValue: '0', resetCycle: 'YEARLY', isActive: true });
    em.create(QuotaEntitlement, { quota, employee, year: 2026, entitledValue: '5', carriedOver: '0', adjusted: '0' });

    const vendorNotEnabled = em.create(Vendor, { vendorCode: 'V-NE', name: 'NotEnabled', paymentTermDays: 30, isActive: true });

    await em.flush();
    GLOBAL.userId = user.id;
    Object.assign(ids, {
      companyA: companyA.id, deptA: deptA.id, companyB: companyB.id, deptB: deptB.id,
      dtPlain: dtPlain.id, dtBudget: dtBudget.id, dtQuota: dtQuota.id, dtPO: dtPO.id, dtVendorReq: dtVendorReq.id,
      tmplPlain: tmplPlain.id, reasonField: reasonField.id,
      bA1: bA1.id, bA2: bA2.id, bB1: bB1.id,
      quota: quota.id, employee: employee.id, vendorNotEnabled: vendorNotEnabled.id,
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
    const numbering = new NumberingService(orm.em);
    const itemService = new ItemService(orm.em, scope, new ScopeService());
    const vendorService = new VendorService(orm.em, scope, new ScopeService());
    const budgetService = new BudgetService(orm.em, new AccountService(orm.em, scope));
    const fiscalYearService = new FiscalYearService(scope);
    documents = new DocumentService(
      orm.em,
      scope,
      new DeptDocTypeService(orm.em),
      numbering,
      itemService,
      budgetService,
      fiscalYearService,
    );
    const budgetBal = new BudgetBalanceService(orm.em);
    budgetBalance = budgetBal;
    submit = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      new FiscalYearService(scope),
      vendorService,
      itemService,
      new BudgetLedgerService(orm.em, budgetBal),
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
  });

  const budgetTxns = (documentId: string) =>
    orm.em.fork().find(BudgetTxn, { document: documentId }, { filters: { company: false } });
  const quotaRows = (documentId: string) =>
    orm.em.fork().find(QuotaUsage, { document: documentId }, { filters: { company: false } });

  // ---- 7.1 Numbering concurrency ---------------------------------------------

  it('issues unique sequential numbers under concurrent creation', async () => {
    const [d1, d2] = await asCtx(ids.companyA, ids.deptA, () =>
      Promise.all([
        documents.createDraft({ documentTypeId: ids.dtPlain }),
        documents.createDraft({ documentTypeId: ids.dtPlain }),
      ]),
    );
    expect(d1.docNo).not.toBe(d2.docNo);
    expect(new Set([d1.docNo, d2.docNo]).size).toBe(2);
  });

  // ---- 7.2 Config-driven: no holds -------------------------------------------

  it('a non-budget/non-quota type creates no holds and reaches SUBMITTED', async () => {
    const doc = await asCtx(ids.companyA, ids.deptA, async () => {
      const d = await documents.createDraft({
        documentTypeId: ids.dtPlain,
        fieldValues: [{ formFieldId: ids.reasonField, value: 'ok' }],
      });
      return submit.submit(d.id);
    });
    expect(doc.status).toBe(DocStatus.SUBMITTED);
    expect(await budgetTxns(doc.id)).toHaveLength(0);
    expect(await quotaRows(doc.id)).toHaveLength(0);
  });

  // ---- 7.3 Multi-line budget -------------------------------------------------

  it('reserves once per budget for a multi-line budget document', async () => {
    const doc = await asCtx(ids.companyA, ids.deptA, async () => {
      const d = await documents.createDraft({
        documentTypeId: ids.dtBudget,
        lines: [
          { lineNo: 1, description: 'a', qty: '1', unitPrice: '100', lineAmount: '100', budgetId: ids.bA1 },
          { lineNo: 2, description: 'b', qty: '1', unitPrice: '200', lineAmount: '200', budgetId: ids.bA2 },
        ],
      });
      return submit.submit(d.id);
    });
    const txns = await budgetTxns(doc.id);
    const reserves = txns.filter((t) => t.txnType === BudgetTxnType.RESERVE);
    expect(reserves).toHaveLength(2);
    expect(Number(reserves.find((t) => t.budget.id === ids.bA1)!.amount)).toBe(100);
    expect(Number(reserves.find((t) => t.budget.id === ids.bA2)!.amount)).toBe(200);
  });

  // ---- 7.4 Locked FX ---------------------------------------------------------

  it('locks the FX rate and base amounts at submit', async () => {
    const doc = await asCtx(ids.companyA, ids.deptA, async () => {
      const d = await documents.createDraft({
        documentTypeId: ids.dtBudget,
        currency: 'USD',
        lines: [{ lineNo: 1, description: 'x', qty: '1', unitPrice: '100', lineAmount: '100', budgetId: ids.bA1 }],
      });
      return submit.submit(d.id);
    });
    expect(Number(doc.exchangeRate)).toBe(35);
    expect(Number(doc.baseTotalAmount)).toBe(3500); // 100 USD × 35
  });

  // ---- 7.5 Validation & guards ----------------------------------------------

  it('rejects submit on a missing required field and leaves it DRAFT', async () => {
    const { id } = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({ documentTypeId: ids.dtPlain }),
    );
    await expect(asCtx(ids.companyA, ids.deptA, () => submit.submit(id))).rejects.toThrow();
    const reread = await orm.em.fork().findOneOrFail(Document, { id }, { filters: { company: false } });
    expect(reread.status).toBe(DocStatus.DRAFT);
  });

  it('rejects submit when requires_vendor is set but no vendor, leaving it DRAFT', async () => {
    const { id } = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({ documentTypeId: ids.dtVendorReq }),
    );
    await expect(asCtx(ids.companyA, ids.deptA, () => submit.submit(id))).rejects.toThrow(/vendor/i);
    const reread = await orm.em.fork().findOneOrFail(Document, { id }, { filters: { company: false } });
    expect(reread.status).toBe(DocStatus.DRAFT);
  });

  it('rejects submit into a CLOSED fiscal period', async () => {
    await expect(
      asCtx(ids.companyB, ids.deptB, async () => {
        const d = await documents.createDraft({
          documentTypeId: ids.dtBudget,
          lines: [{ lineNo: 1, description: 'x', qty: '1', unitPrice: '10', lineAmount: '10', budgetId: ids.bB1 }],
        });
        return submit.submit(d.id);
      }),
    ).rejects.toThrow();
  });

  it('rejects submit with a vendor not enabled for the company', async () => {
    await expect(
      asCtx(ids.companyA, ids.deptA, async () => {
        const d = await documents.createDraft({
          documentTypeId: ids.dtBudget,
          vendorId: ids.vendorNotEnabled,
          lines: [{ lineNo: 1, description: 'x', qty: '1', unitPrice: '10', lineAmount: '10', budgetId: ids.bA1 }],
        });
        return submit.submit(d.id);
      }),
    ).rejects.toThrow();
  });

  // ---- 7.6 Cancel releases holds; quota reserve ------------------------------

  it('cancel releases all budget holds', async () => {
    const doc = await asCtx(ids.companyA, ids.deptA, async () => {
      const d = await documents.createDraft({
        documentTypeId: ids.dtBudget,
        lines: [{ lineNo: 1, description: 'x', qty: '1', unitPrice: '100', lineAmount: '100', budgetId: ids.bA1 }],
      });
      await submit.submit(d.id);
      await submit.cancel(d.id);
      return d;
    });
    expect(Number(await budgetBalance.outstandingReserved(doc.id, ids.bA1))).toBe(0);
  });

  it('reserves quota for a requires_quota document', async () => {
    const doc = await asCtx(ids.companyA, ids.deptA, async () => {
      const d = await documents.createDraft({ documentTypeId: ids.dtQuota });
      return submit.submit(d.id, {
        quotaReservations: [{ quotaId: ids.quota, employeeId: ids.employee, qty: '2', year: 2026 }],
      });
    });
    const rows = await quotaRows(doc.id);
    expect(rows.filter((r) => r.usageType === 'USE')).toHaveLength(1);
  });

  // ---- 7.7 Reference chain & versioned form ----------------------------------

  it('sets the reference chain and pins the form template version', async () => {
    const { doc1Id, predId, succRefId } = await asCtx(ids.companyA, ids.deptA, async () => {
      // Reference chain: an APPROVED PR → a PO that references it (a permitted REF_CHAIN pairing).
      const pred = await documents.createDraft({ documentTypeId: ids.dtBudget });
      const pfork = orm.em.fork();
      const pdoc = await pfork.findOneOrFail(Document, { id: pred.id }, { filters: { company: false } });
      pdoc.status = DocStatus.APPROVED;
      await pfork.flush();
      const succ = await documents.createDraft({ documentTypeId: ids.dtPO, refDocumentId: pred.id });
      // Form-template version pinning (independent of the chain): a plain doc.
      const doc1 = await documents.createDraft({ documentTypeId: ids.dtPlain, fieldValues: [{ formFieldId: ids.reasonField, value: 'a' }] });
      return { doc1Id: doc1.id, predId: pred.id, succRefId: succ.refDocument?.id };
    });
    expect(succRefId).toBe(predId);

    // Publish a v2 template for the plain type; the old document keeps v1.
    const templates = new FormTemplateService(orm.em);
    await templates.createTemplate({ documentTypeId: ids.dtPlain });
    const reread = await orm.em.fork().findOneOrFail(Document, { id: doc1Id }, { filters: { company: false } });
    expect(reread.formTemplate.id).toBe(ids.tmplPlain);
  });

  // ---- 7.8 Company-scoped content mutations ----------------------------------

  const fieldValues = (documentId: string) =>
    orm.em.fork().find(DocFieldValue, { document: documentId }, { filters: { company: false } });
  const lines = (documentId: string) =>
    orm.em.fork().find(DocumentLine, { document: documentId }, { filters: { company: false } });

  it('setFieldValues persists values for a document in the active company', async () => {
    const { id } = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({ documentTypeId: ids.dtPlain }),
    );
    await asCtx(ids.companyA, ids.deptA, () =>
      documents.setFieldValues(id, [{ formFieldId: ids.reasonField, value: 'hello' }]),
    );
    const rows = await fieldValues(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].fieldValue).toBe('hello');
  });

  it('setFieldValues on another company document is not-found and writes nothing', async () => {
    const { id } = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({ documentTypeId: ids.dtPlain }),
    );
    await expect(
      asCtx(ids.companyB, ids.deptB, () =>
        documents.setFieldValues(id, [{ formFieldId: ids.reasonField, value: 'leak' }]),
      ),
    ).rejects.toThrow(NotFoundException);
    expect(await fieldValues(id)).toHaveLength(0);
  });

  it('setLines on another company document is not-found and writes nothing', async () => {
    const { id } = await asCtx(ids.companyA, ids.deptA, () =>
      documents.createDraft({ documentTypeId: ids.dtBudget }),
    );
    await expect(
      asCtx(ids.companyB, ids.deptB, () =>
        documents.setLines(id, [
          { lineNo: 1, description: 'leak', qty: '1', unitPrice: '1', lineAmount: '1', budgetId: ids.bB1 },
        ]),
      ),
    ).rejects.toThrow(NotFoundException);
    expect(await lines(id)).toHaveLength(0);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[document-engine] no database reachable — skipping DB-backed spec');
}
