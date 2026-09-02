import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { BadRequestException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetService } from '../budget/budget.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { AccountService } from '../accounting/account.service';
import { Currency } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { ItemService } from '../master-data/item.service';
import { Vendor, VendorBankAccount } from '../master-data/master-data.entities';
import { VendorService } from '../master-data/vendor.service';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import {
  Company,
  Department,
  FiscalYear,
} from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { Workflow, WorkflowStep } from '../approval/approval.entities';
import { DocumentSubmitService } from './document-submit.service';
import { DocumentService } from './document.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import { NumberingService } from './numbering.service';
import {
  DeptDocType,
  Document,
  DocumentType,
  FormTemplate,
} from './document.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The submit-time payee gate.
 *
 * The gate branches on `document_type.requires_payee`, never on `post_action` — the distinction
 * this whole file exists to protect. The seeded PR carries CUT_BUDGET so it can settle its own
 * reservation, but a requisition has no payee yet, so a gate keyed off CUT_BUDGET would block every
 * PR submit in the product.
 */
describe.skipIf(!hasDb)('payee gate at submit (DB-backed)', () => {
  let orm: MikroORM;
  let submit: DocumentSubmitService;
  let documents: DocumentService;

  const ids = {
    company: '', dept: '', fy: '', user: '', wf: '',
    vendor: '', otherVendor: '', account: '', inactiveAccount: '', otherVendorAccount: '',
    payeeType: '', cutBudgetNoPayeeType: '', payeeTmpl: '', cutTmpl: '', budget: '',
  };
  let seq = 0;

  function asUser<T>(fn: () => Promise<T>): Promise<T> {
    return RequestContext.run(
      { userId: ids.user, companyId: ids.company, departmentId: ids.dept, grants: [] },
      fn,
    );
  }

  /** A DRAFT document of `typeId`, optionally naming a payee. */
  async function draft(typeId: string, tmplId: string, payeeId?: string): Promise<string> {
    const em = orm.em.fork();
    const d = em.create(Document, {
      docNo: `D-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, typeId),
      formTemplate: em.getReference(FormTemplate, tmplId),
      workflow: em.getReference(Workflow, ids.wf),
      currentStepNo: 0,
      createdBy: em.getReference(AppUser, ids.user),
      vendor: em.getReference(Vendor, ids.vendor),
      vendorBankAccount: payeeId ? em.getReference(VendorBankAccount, payeeId) : undefined,
      exchangeRate: '1',
      totalAmount: '1000',
      status: DocStatus.DRAFT,
      createdAt: new Date(),
    });
    em.create('DocumentLine' as never, {
      document: d,
      lineNo: 1,
      description: 'thing',
      qty: '1',
      unitPrice: '1000',
      lineAmount: '1000',
      budget: em.getReference(Budget, ids.budget),
      lineStatus: 'OPEN',
      receivedQty: '0',
    } as never);
    await em.flush();
    return d.id;
  }

  function txnsFor(documentId: string): Promise<BudgetTxn[]> {
    return orm.em.fork().find(BudgetTxn, { document: documentId }, FILTER_OFF);
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();

    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const dept = em.create(Department, { company, deptCode: 'D', name: 'D', isActive: true });
    const year = new Date().getUTCFullYear();
    const fy = em.create(FiscalYear, { company, year, startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: 'OPEN' });
    const user = em.create(AppUser, { username: 'req', email: 'req@x', status: 'ACTIVE' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    em.create(WorkflowStep, { workflow: wf, stepNo: 1, approveMode: 'SEQUENTIAL', showSignatureOnPdf: true });

    const vendor = em.create(Vendor, { vendorCode: 'V1', name: 'Acme', paymentTermDays: 30, isActive: true });
    const otherVendor = em.create(Vendor, { vendorCode: 'V2', name: 'Other', paymentTermDays: 30, isActive: true });
    const account = em.create(VendorBankAccount, { vendor, bankCode: 'BKK', accountNo: '0001', accountName: 'Acme', isPrimary: true, isActive: true });
    const inactiveAccount = em.create(VendorBankAccount, { vendor, bankCode: 'BKK', accountNo: '0002', accountName: 'Acme old', isPrimary: false, isActive: false });
    const otherVendorAccount = em.create(VendorBankAccount, { vendor: otherVendor, bankCode: 'SCB', accountNo: '9999', accountName: 'Other', isPrimary: true, isActive: true });

    // requires_payee — a disbursement.
    const payeeType = em.create(DocumentType, { company, code: 'DISB', name: 'Disbursement', category: DocCategory.FINANCE, requiresBudget: true, requiresQuota: false, requiresVendor: true, requiresItem: false, requiresPayee: true, requiresWarehouse: false, postAction: 'CUT_BUDGET', isActive: true });
    // CUT_BUDGET but NOT requires_payee — the PR shape, and the regression this file guards.
    const cutBudgetNoPayeeType = em.create(DocumentType, { company, code: 'PR', name: 'Purchase Requisition', category: DocCategory.PROCUREMENT, requiresBudget: true, requiresQuota: false, requiresVendor: true, requiresItem: false, requiresPayee: false, requiresWarehouse: false, postAction: 'CUT_BUDGET', isActive: true });

    const payeeTmpl = em.create(FormTemplate, { documentType: payeeType, version: 1, status: 'PUBLISHED' });
    const cutTmpl = em.create(FormTemplate, { documentType: cutBudgetNoPayeeType, version: 1, status: 'PUBLISHED' });
    em.create(DeptDocType, { department: dept, documentType: payeeType, formTemplate: payeeTmpl, workflow: wf, isActive: true });
    em.create(DeptDocType, { department: dept, documentType: cutBudgetNoPayeeType, formTemplate: cutTmpl, workflow: wf, isActive: true });
    em.create('VendorCompany' as never, { vendor, company, isActive: true } as never);
    em.create('VendorCompany' as never, { vendor: otherVendor, company, isActive: true } as never);

    const budget = budgetAt(em, { fiscalYear: fy, department: dept, code: 'GL1', glAccount: 'GL1', amountTotal: '1000000', controlPolicy: 'HARD_STOP', status: 'ACTIVE' });
    attachCoverage(em, company, budget);
    em.create(Currency, { code: 'USD', name: 'Dollar', decimalPlaces: 2, isActive: true });
    await em.flush();

    Object.assign(ids, {
      company: company.id, dept: dept.id, fy: fy.id, user: user.id, wf: wf.id,
      vendor: vendor.id, otherVendor: otherVendor.id,
      account: account.id, inactiveAccount: inactiveAccount.id, otherVendorAccount: otherVendorAccount.id,
      payeeType: payeeType.id, cutBudgetNoPayeeType: cutBudgetNoPayeeType.id,
      payeeTmpl: payeeTmpl.id, cutTmpl: cutTmpl.id, budget: budget.id,
    });

    const scope = new CompanyScopeService(orm.em);
    const accounts = new AccountService(orm.em, scope);
    const balance = new BudgetBalanceService(orm.em);
    documents = new DocumentService(
      orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em),
      new ItemService(orm.em, scope, new ScopeService(), accounts),
      new BudgetService(orm.em, accounts, new BudgetBalanceService(orm.em)), new FiscalYearService(scope),
    );
    submit = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em, scope),
      new FiscalYearService(scope),
      new VendorService(orm.em, scope, new ScopeService()),
      new ItemService(orm.em, scope, new ScopeService(), accounts),
      new BudgetLedgerService(orm.em, balance, new BudgetCoverageService(orm.em)),
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
  });

  beforeEach(async () => {
    await orm.em.fork().nativeDelete(BudgetTxn, {}, FILTER_OFF);
  });

  // ---- The PR regression -----------------------------------------------------

  it('lets a CUT_BUDGET type without requires_payee submit with no payee', async () => {
    const id = await draft(ids.cutBudgetNoPayeeType, ids.cutTmpl);

    await asUser(() => submit.submit(id));

    // Keying the gate off post_action would have blocked this — every requisition in the product.
    const doc = await orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);
    expect(doc.status).toBe(DocStatus.SUBMITTED);
    expect(await txnsFor(id)).toHaveLength(1); // the budget still reserved as before
  });

  // ---- The gate --------------------------------------------------------------

  it('rejects a requires_payee submit with no payee, reserving nothing', async () => {
    const id = await draft(ids.payeeType, ids.payeeTmpl);

    await expect(asUser(() => submit.submit(id))).rejects.toThrow(BadRequestException);

    // The gate sits before any hold, so a rejected submit leaves the draft clean.
    const doc = await orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);
    expect(doc.status).toBe(DocStatus.DRAFT);
    expect(await txnsFor(id)).toHaveLength(0);
  });

  it('rejects a payee belonging to another vendor', async () => {
    const id = await draft(ids.payeeType, ids.payeeTmpl, ids.otherVendorAccount);

    await expect(asUser(() => submit.submit(id))).rejects.toThrow(
      /does not belong to this document's vendor/,
    );
    expect(await txnsFor(id)).toHaveLength(0);
  });

  it('rejects a payee deactivated while the document sat in draft', async () => {
    const id = await draft(ids.payeeType, ids.payeeTmpl, ids.inactiveAccount);

    await expect(asUser(() => submit.submit(id))).rejects.toThrow(/no longer active/);
    expect(await txnsFor(id)).toHaveLength(0);
  });

  it('accepts an active payee of the document vendor', async () => {
    const id = await draft(ids.payeeType, ids.payeeTmpl, ids.account);

    await asUser(() => submit.submit(id));

    const doc = await orm.em.fork().findOneOrFail(
      Document, { id }, { ...FILTER_OFF, populate: ['vendorBankAccount'] },
    );
    expect(doc.status).toBe(DocStatus.SUBMITTED);
    expect(doc.vendorBankAccount?.id).toBe(ids.account);
  });

  // ---- Immutability ----------------------------------------------------------

  it('refuses to change the payee once the document has left DRAFT', async () => {
    const id = await draft(ids.payeeType, ids.payeeTmpl, ids.account);
    await asUser(() => submit.submit(id));

    // Finance must not be able to redirect a payment six people already approved.
    await expect(asUser(() => documents.setPayee(id, ids.account))).rejects.toThrow(
      /only be changed while the document is a draft/,
    );
  });

  it('reopens the payee once the document is returned to DRAFT', async () => {
    const id = await draft(ids.payeeType, ids.payeeTmpl, ids.account);
    await asUser(() => submit.submit(id));

    const em = orm.em.fork();
    const doc = await em.findOneOrFail(Document, { id }, FILTER_OFF);
    doc.status = DocStatus.DRAFT; // as an approver's RETURN does
    await em.flush();

    await asUser(() => documents.setPayee(id, ids.account));

    // Changing it costs a fresh trip through every approval step — that is the point, not a cost.
    const fresh = await orm.em.fork().findOneOrFail(
      Document, { id }, { ...FILTER_OFF, populate: ['vendorBankAccount'] },
    );
    expect(fresh.vendorBankAccount?.id).toBe(ids.account);
  });

  it('refuses to set a payee of a different vendor on a draft', async () => {
    const id = await draft(ids.payeeType, ids.payeeTmpl);

    await expect(asUser(() => documents.setPayee(id, ids.otherVendorAccount))).rejects.toThrow(
      /does not belong to this document's vendor/,
    );
  });
});
