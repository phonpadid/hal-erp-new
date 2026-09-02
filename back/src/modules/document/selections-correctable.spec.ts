import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetService } from '../budget/budget.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { Warehouse } from '../inventory/inventory.entities';
import { WarehouseService } from '../inventory/warehouse.service';
import { ItemService } from '../master-data/item.service';
import { Vendor, VendorBankAccount } from '../master-data/master-data.entities';
import { VendorService } from '../master-data/vendor.service';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { Workflow, WorkflowStep } from '../approval/approval.entities';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentSubmitService } from './document-submit.service';
import { DocumentService } from './document.service';
import { NumberingService } from './numbering.service';
import { DeptDocType, Document, DocumentType, FormTemplate } from './document.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Correcting the selections a draft's TYPE asks for.
 *
 * These four columns were written only by create, and the submit gates require them when the type
 * asks. A draft missing one was therefore unfinishable AND unfixable — and a type can gain
 * `requires_warehouse` or `requires_employee` after its drafts exist, stranding all of them at once
 * through no act of their authors. That second path is the one worth keeping a test on: it needs no
 * mistake by anybody to reach.
 *
 * The rule is the payee's rule, generalised: mutable while DRAFT, refused once the document has
 * left it, because what the approvers approved is what gets acted on.
 */
describe.skipIf(!hasDb)('a draft\'s type-driven selections can be corrected (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  let submit: DocumentSubmitService;

  const ids = {
    company: '', otherCompany: '', dept: '', otherDept: '', fy: '', user: '', wf: '',
    mainWh: '', destWh: '', inactiveWh: '', otherCompanyWh: '',
    employee: '', otherCompanyEmployee: '',
    vendor: '', unenabledVendor: '', payee: '', otherVendorPayee: '',
    issueType: '', xferType: '', promoteType: '', disbType: '', whOnlyType: '',
    issueTmpl: '', xferTmpl: '', promoteTmpl: '', disbTmpl: '', whOnlyTmpl: '', budget: '',
  };
  let seq = 0;

  function asUser<T>(fn: () => Promise<T>): Promise<T> {
    return RequestContext.run(
      { userId: ids.user, companyId: ids.company, departmentId: ids.dept, grants: [] },
      fn,
    );
  }

  interface DraftOpts {
    status?: DocStatus;
    warehouse?: string;
    destWarehouse?: string;
    relatedEmployee?: string;
    vendor?: string;
    payee?: string;
  }

  async function draft(typeId: string, tmplId: string, o: DraftOpts = {}): Promise<string> {
    const em = orm.em.fork();
    const d = em.create(Document, {
      docNo: `SEL-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, typeId),
      formTemplate: em.getReference(FormTemplate, tmplId),
      workflow: em.getReference(Workflow, ids.wf),
      currentStepNo: 0,
      createdBy: em.getReference(AppUser, ids.user),
      warehouse: o.warehouse ? em.getReference(Warehouse, o.warehouse) : undefined,
      destWarehouse: o.destWarehouse ? em.getReference(Warehouse, o.destWarehouse) : undefined,
      relatedEmployee: o.relatedEmployee ? em.getReference(Employee, o.relatedEmployee) : undefined,
      vendor: o.vendor ? em.getReference(Vendor, o.vendor) : undefined,
      vendorBankAccount: o.payee ? em.getReference(VendorBankAccount, o.payee) : undefined,
      exchangeRate: '1',
      totalAmount: '1000',
      status: o.status ?? DocStatus.DRAFT,
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

  function reload(id: string): Promise<Document> {
    return orm.em
      .fork()
      .findOneOrFail(
        Document,
        { id },
        { populate: ['warehouse', 'destWarehouse', 'relatedEmployee', 'vendor', 'vendorBankAccount'], ...FILTER_OFF },
      );
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();

    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const otherCompany = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true });
    const dept = em.create(Department, { company, deptCode: 'D', name: 'D', isActive: true });
    const otherDept = em.create(Department, { company: otherCompany, deptCode: 'D', name: 'D', isActive: true });
    const year = new Date().getUTCFullYear();
    const fy = em.create(FiscalYear, { company, year, startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: 'OPEN' });
    const user = em.create(AppUser, { username: 'req', email: 'req@x', status: 'ACTIVE' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    em.create(WorkflowStep, { workflow: wf, stepNo: 1, approveMode: 'SEQUENTIAL', showSignatureOnPdf: true });

    const mainWh = em.create(Warehouse, { company, code: 'MAIN', name: 'Main', isActive: true });
    const destWh = em.create(Warehouse, { company, code: 'DEST', name: 'Dest', isActive: true });
    const inactiveWh = em.create(Warehouse, { company, code: 'OLD', name: 'Old', isActive: false });
    const otherCompanyWh = em.create(Warehouse, { company: otherCompany, code: 'BMAIN', name: 'B main', isActive: true });

    const employee = em.create(Employee, { company, department: dept, empCode: 'E1', fullName: 'Somchai' });
    const otherCompanyEmployee = em.create(Employee, { company: otherCompany, department: otherDept, empCode: 'E2', fullName: 'Somsri' });

    const vendor = em.create(Vendor, { vendorCode: 'V1', name: 'Acme', paymentTermDays: 30, isActive: true });
    const unenabledVendor = em.create(Vendor, { vendorCode: 'V2', name: 'Nowhere', paymentTermDays: 30, isActive: true });
    const otherVendor = em.create(Vendor, { vendorCode: 'V3', name: 'Other', paymentTermDays: 30, isActive: true });
    const payee = em.create(VendorBankAccount, { vendor, bankCode: 'BKK', accountNo: '0001', accountName: 'Acme', isPrimary: true, isActive: true });
    const otherVendorPayee = em.create(VendorBankAccount, { vendor: otherVendor, bankCode: 'SCB', accountNo: '9999', accountName: 'Other', isPrimary: true, isActive: true });
    // `vendor` and `otherVendor` are enabled here; `unenabledVendor` deliberately is not.
    em.create('VendorCompany' as never, { vendor, company, isActive: true } as never);
    em.create('VendorCompany' as never, { vendor: otherVendor, company, isActive: true } as never);

    const issueType = em.create(DocumentType, { company, code: 'ISSUE', name: 'Goods Issue', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false, requiresPayee: false, requiresWarehouse: true, postAction: 'ISSUE_STOCK', isActive: true });
    const xferType = em.create(DocumentType, { company, code: 'XFER', name: 'Stock Transfer', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false, requiresPayee: false, requiresWarehouse: true, postAction: 'TRANSFER_STOCK', isActive: true });
    // Starts with requires_employee OFF: the drafts made under it are the ones an administrator
    // strands by turning the flag on later, which is the path this file cares most about.
    const promoteType = em.create(DocumentType, { company, code: 'PROMOTE', name: 'Promotion', category: DocCategory.HR, requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false, requiresPayee: false, requiresWarehouse: false, requiresEmployee: false, isActive: true });
    // requires_warehouse WITHOUT a stock post-action, so the submit assertions exercise the
    // warehouse GATE — the thing a correction unblocks — without dragging stock reservation in.
    const whOnlyType = em.create(DocumentType, { company, code: 'WHONLY', name: 'Warehouse only', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false, requiresPayee: false, requiresWarehouse: true, isActive: true });
    const disbType = em.create(DocumentType, { company, code: 'DISB', name: 'Disbursement', category: DocCategory.FINANCE, requiresBudget: false, requiresQuota: false, requiresVendor: true, requiresItem: false, requiresPayee: true, requiresWarehouse: false, isActive: true });

    const issueTmpl = em.create(FormTemplate, { documentType: issueType, version: 1, status: 'PUBLISHED' });
    const xferTmpl = em.create(FormTemplate, { documentType: xferType, version: 1, status: 'PUBLISHED' });
    const promoteTmpl = em.create(FormTemplate, { documentType: promoteType, version: 1, status: 'PUBLISHED' });
    const disbTmpl = em.create(FormTemplate, { documentType: disbType, version: 1, status: 'PUBLISHED' });
    const whOnlyTmpl = em.create(FormTemplate, { documentType: whOnlyType, version: 1, status: 'PUBLISHED' });
    for (const [t, tm] of [[issueType, issueTmpl], [xferType, xferTmpl], [promoteType, promoteTmpl], [disbType, disbTmpl], [whOnlyType, whOnlyTmpl]] as const) {
      em.create(DeptDocType, { department: dept, documentType: t, formTemplate: tm, workflow: wf, isActive: true });
    }

    const budget = budgetAt(em, { fiscalYear: fy, department: dept, code: 'GL1', glAccount: 'GL1', amountTotal: '1000000', controlPolicy: 'HARD_STOP', status: 'ACTIVE' });
    attachCoverage(em, company, budget);
    await em.flush();

    Object.assign(ids, {
      company: company.id, otherCompany: otherCompany.id, dept: dept.id, otherDept: otherDept.id,
      fy: fy.id, user: user.id, wf: wf.id,
      mainWh: mainWh.id, destWh: destWh.id, inactiveWh: inactiveWh.id, otherCompanyWh: otherCompanyWh.id,
      employee: employee.id, otherCompanyEmployee: otherCompanyEmployee.id,
      vendor: vendor.id, unenabledVendor: unenabledVendor.id,
      payee: payee.id, otherVendorPayee: otherVendorPayee.id,
      issueType: issueType.id, xferType: xferType.id, promoteType: promoteType.id, disbType: disbType.id,
      whOnlyType: whOnlyType.id, whOnlyTmpl: whOnlyTmpl.id,
      issueTmpl: issueTmpl.id, xferTmpl: xferTmpl.id, promoteTmpl: promoteTmpl.id, disbTmpl: disbTmpl.id,
      budget: budget.id,
    });

    const scope = new CompanyScopeService(orm.em);
    const accounts = new AccountService(orm.em, scope);
    const balance = new BudgetBalanceService(orm.em);
    const vendors = new VendorService(orm.em, scope, new ScopeService());
    documents = new DocumentService(
      orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em),
      new ItemService(orm.em, scope, new ScopeService(), accounts),
      new BudgetService(orm.em, accounts, balance), new FiscalYearService(scope),
      new WarehouseService(scope), vendors,
    );
    submit = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em, scope),
      new FiscalYearService(scope),
      vendors,
      new ItemService(orm.em, scope, new ScopeService(), accounts),
      new BudgetLedgerService(orm.em, balance, new BudgetCoverageService(orm.em)),
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
      undefined, undefined, new WarehouseService(scope),
    );
  });

  beforeEach(async () => {
    await orm.em.fork().nativeDelete(BudgetTxn, {}, FILTER_OFF);
    // Each test starts from the shipped flags; the ones that flip a flag put it back here.
    const em = orm.em.fork();
    const promote = await em.findOneOrFail(DocumentType, { id: ids.promoteType }, FILTER_OFF);
    promote.requiresEmployee = false;
    await em.flush();
  });

  // ---- What the change exists for --------------------------------------------

  it('gives a stranded draft the warehouse its type requires', async () => {
    const id = await draft(ids.issueType, ids.issueTmpl); // no warehouse: unsubmittable

    await asUser(() => documents.setSelections(id, { warehouseId: ids.mainWh }));

    expect((await reload(id)).warehouse?.id).toBe(ids.mainWh);
  });

  it('does not strand the drafts of a type that gains requires_employee', async () => {
    // Nobody made a mistake: the drafts were valid when written, and an administrator turned the
    // flag on afterwards. Without a correction surface every one of them is unfinishable forever.
    const id = await draft(ids.promoteType, ids.promoteTmpl);
    const em = orm.em.fork();
    const promote = await em.findOneOrFail(DocumentType, { id: ids.promoteType }, FILTER_OFF);
    promote.requiresEmployee = true;
    await em.flush();

    await asUser(() => documents.setSelections(id, { relatedEmployeeId: ids.employee }));

    expect((await reload(id)).relatedEmployee?.id).toBe(ids.employee);
  });

  it('lets a corrected draft submit, which it could not do before', async () => {
    const id = await draft(ids.whOnlyType, ids.whOnlyTmpl);
    await expect(asUser(() => submit.submit(id))).rejects.toThrow(BadRequestException);

    await asUser(() => documents.setSelections(id, { warehouseId: ids.mainWh }));
    await asUser(() => submit.submit(id));

    expect((await reload(id)).status).toBe(DocStatus.SUBMITTED);
  });

  // ---- DRAFT only -------------------------------------------------------------

  it.each([DocStatus.IN_APPROVAL, DocStatus.COMPLETED])(
    'refuses a change on a %s document and leaves it untouched',
    async (status) => {
      const id = await draft(ids.issueType, ids.issueTmpl, { status, warehouse: ids.mainWh });

      await expect(
        asUser(() => documents.setSelections(id, { warehouseId: ids.destWh })),
      ).rejects.toThrow();

      expect((await reload(id)).warehouse?.id).toBe(ids.mainWh);
    },
  );

  it('reopens the selections on a document returned to DRAFT', async () => {
    // The supported way to change an approved document, and it costs the whole chain again.
    const id = await draft(ids.whOnlyType, ids.whOnlyTmpl, { status: DocStatus.DRAFT, warehouse: ids.mainWh });

    await asUser(() => documents.setSelections(id, { warehouseId: ids.destWh }));
    await asUser(() => submit.submit(id));

    const doc = await reload(id);
    expect(doc.warehouse?.id).toBe(ids.destWh);
    expect(doc.status).toBe(DocStatus.SUBMITTED);
  });

  // ---- Invariant 1: a correction cannot reach another company ------------------

  it('refuses another company\'s warehouse', async () => {
    const id = await draft(ids.issueType, ids.issueTmpl, { warehouse: ids.mainWh });

    await expect(
      asUser(() => documents.setSelections(id, { warehouseId: ids.otherCompanyWh })),
    ).rejects.toThrow(BadRequestException);

    expect((await reload(id)).warehouse?.id).toBe(ids.mainWh);
  });

  it('refuses an employee of another company', async () => {
    const id = await draft(ids.promoteType, ids.promoteTmpl);

    await expect(
      asUser(() => documents.setSelections(id, { relatedEmployeeId: ids.otherCompanyEmployee })),
    ).rejects.toThrow(BadRequestException);

    expect((await reload(id)).relatedEmployee).toBeFalsy();
  });

  it('refuses a vendor not enabled for the active company', async () => {
    const id = await draft(ids.disbType, ids.disbTmpl, { vendor: ids.vendor });

    await expect(
      asUser(() => documents.setSelections(id, { vendorId: ids.unenabledVendor })),
    ).rejects.toThrow(BadRequestException);

    expect((await reload(id)).vendor?.id).toBe(ids.vendor);
  });

  it('refuses an inactive warehouse', async () => {
    const id = await draft(ids.issueType, ids.issueTmpl);

    await expect(
      asUser(() => documents.setSelections(id, { warehouseId: ids.inactiveWh })),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a transfer that names the same warehouse at both ends', async () => {
    const id = await draft(ids.xferType, ids.xferTmpl);

    await expect(
      asUser(() =>
        documents.setSelections(id, { warehouseId: ids.mainWh, destWarehouseId: ids.mainWh }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('catches a collision against the end that is already set', async () => {
    // Only one end is supplied, so checking the SUPPLIED pair would miss this entirely.
    const id = await draft(ids.xferType, ids.xferTmpl, { warehouse: ids.mainWh });

    await expect(
      asUser(() => documents.setSelections(id, { destWarehouseId: ids.mainWh })),
    ).rejects.toThrow(BadRequestException);
  });

  it('applies nothing when one supplied id is bad', async () => {
    // A request is one correction, not a series: a good warehouse must not land while the employee
    // beside it is refused, or the user is left guessing which half took.
    //
    // What actually protects this is the SINGLE flush — resolving everything up front only makes
    // the intent legible. Mutation-checked by flushing half-way through instead: this test fails,
    // while reordering the resolutions alone does not, because an unflushed assignment never
    // reaches the database anyway.
    const id = await draft(ids.promoteType, ids.promoteTmpl);

    await expect(
      asUser(() =>
        documents.setSelections(id, {
          warehouseId: ids.mainWh,
          relatedEmployeeId: ids.otherCompanyEmployee,
        }),
      ),
    ).rejects.toThrow(BadRequestException);

    expect((await reload(id)).warehouse).toBeFalsy();
  });

  // ---- Vendor and payee stay consistent ---------------------------------------

  it('drops a payee the new vendor does not own', async () => {
    const id = await draft(ids.disbType, ids.disbTmpl, { vendor: ids.vendor, payee: ids.payee });

    // 'otherVendor' is enabled for this company but does not own `payee`.
    const em = orm.em.fork();
    const otherVendorId = (await em.findOneOrFail(Vendor, { vendorCode: 'V3' })).id;
    await asUser(() => documents.setSelections(id, { vendorId: otherVendorId }));

    const doc = await reload(id);
    expect(doc.vendor?.id).toBe(otherVendorId);
    expect(doc.vendorBankAccount).toBeFalsy();
  });

  it('keeps a payee the vendor still owns', async () => {
    const id = await draft(ids.disbType, ids.disbTmpl, { vendor: ids.vendor, payee: ids.payee });

    await asUser(() => documents.setSelections(id, { vendorId: ids.vendor }));

    expect((await reload(id)).vendorBankAccount?.id).toBe(ids.payee);
  });

  // ---- Absent is not null ------------------------------------------------------

  it('clears a selection on an explicit null', async () => {
    // A type that loses requires_warehouse must be able to have the warehouse taken back off.
    const id = await draft(ids.issueType, ids.issueTmpl, { warehouse: ids.mainWh });

    await asUser(() => documents.setSelections(id, { warehouseId: null }));

    expect((await reload(id)).warehouse).toBeFalsy();
  });

  it('leaves a selection alone when its key is absent', async () => {
    const id = await draft(ids.issueType, ids.issueTmpl, {
      warehouse: ids.mainWh,
      relatedEmployee: ids.employee,
    });

    await asUser(() => documents.setSelections(id, { relatedEmployeeId: null }));

    const doc = await reload(id);
    expect(doc.relatedEmployee).toBeFalsy();
    expect(doc.warehouse?.id).toBe(ids.mainWh); // untouched, not cleared alongside
  });

  // ---- The correction surface does not relax the gates -------------------------

  it('still refuses to submit a document whose required selection was cleared', async () => {
    const id = await draft(ids.whOnlyType, ids.whOnlyTmpl, { warehouse: ids.mainWh });

    await asUser(() => documents.setSelections(id, { warehouseId: null }));

    await expect(asUser(() => submit.submit(id))).rejects.toThrow(BadRequestException);
    expect((await reload(id)).status).toBe(DocStatus.DRAFT);
  });

  // ---- Ledger --------------------------------------------------------------------

  it('writes no budget row', async () => {
    // Why there is no concurrency test here: this flow writes neither budget_txn nor quota_usage
    // and takes no lock. It is refused outside DRAFT, which is before submit reserves anything, so
    // no reservation exists for a corrected document and there is nothing to race against.
    const id = await draft(ids.issueType, ids.issueTmpl);

    await asUser(() => documents.setSelections(id, { warehouseId: ids.mainWh }));

    expect(await orm.em.fork().count(BudgetTxn, { document: id }, FILTER_OFF)).toBe(0);
  });
});
