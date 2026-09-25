import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { signAllUsers } from '../../test/signature-fixture';
import { AccountService } from '../accounting/account.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetService } from '../budget/budget.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Currency, ExchangeRate } from '../currency/currency.entities';
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
    issueType: '', xferType: '', promoteType: '', disbType: '', whOnlyType: '', pastType: '',
    issueTmpl: '', xferTmpl: '', promoteTmpl: '', disbTmpl: '', whOnlyTmpl: '', pastTmpl: '',
    budget: '',
  };
  let seq = 0;

  function asUser<T>(fn: () => Promise<T>): Promise<T> {
    return RequestContext.run(
      { userId: ids.user, companyId: ids.company, departmentId: ids.dept, grants: [] },
      fn,
    );
  }

  /** The same caller, holding permission codes. `money_moved_on` is the only correction here that
   *  asks for one, so the grants are opt-in rather than folded into `asUser`. */
  function asUserWith<T>(codes: string[], fn: () => Promise<T>): Promise<T> {
    return RequestContext.run(
      {
        userId: ids.user,
        companyId: ids.company,
        departmentId: ids.dept,
        grants: codes.map((code) => ({ code })) as never,
      },
      fn,
    );
  }

  const daysAgo = (n: number): string =>
    new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const daysAhead = (n: number): string =>
    new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  interface DraftOpts {
    status?: DocStatus;
    warehouse?: string;
    destWarehouse?: string;
    relatedEmployee?: string;
    vendor?: string;
    payee?: string;
    currency?: string;
    moneyMovedOn?: string;
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
      // Always set, defaulting to the company base: a real document always names a currency, and
      // the ternary's `Reference<Currency> | undefined` union does not narrow to the field's type.
      currency: em.getReference(Currency, o.currency ?? 'THB'),
      moneyMovedOn: o.moneyMovedOn,
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
        {
          populate: ['warehouse', 'destWarehouse', 'relatedEmployee', 'vendor', 'vendorBankAccount', 'currency'],
          ...FILTER_OFF,
        },
      );
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();

    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    // A second active currency to correct TO, and a retired one to be refused. LAK carries zero
    // decimal places, which is the pair this correction is actually for: a Lao company raising a
    // Thai-baht cost in kip states every line amount in the wrong unit.
    em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 0, isActive: true });
    em.create(Currency, { code: 'XXX', name: 'Retired', decimalPlaces: 2, isActive: false });
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
    // records_past_events: the only kind of type that may state the day its money moved, and so the
    // only one whose draft can have that day corrected. requires_budget, because the whole point of
    // the column is which period the budget rows land in.
    const pastType = em.create(DocumentType, { company, code: 'PAST', name: 'Recorded spend', category: DocCategory.FINANCE, requiresBudget: true, requiresQuota: false, requiresVendor: false, requiresItem: false, requiresPayee: false, requiresWarehouse: false, recordsPastEvents: true, isActive: true });

    const issueTmpl = em.create(FormTemplate, { documentType: issueType, version: 1, status: 'PUBLISHED' });
    const xferTmpl = em.create(FormTemplate, { documentType: xferType, version: 1, status: 'PUBLISHED' });
    const promoteTmpl = em.create(FormTemplate, { documentType: promoteType, version: 1, status: 'PUBLISHED' });
    const disbTmpl = em.create(FormTemplate, { documentType: disbType, version: 1, status: 'PUBLISHED' });
    const whOnlyTmpl = em.create(FormTemplate, { documentType: whOnlyType, version: 1, status: 'PUBLISHED' });
    const pastTmpl = em.create(FormTemplate, { documentType: pastType, version: 1, status: 'PUBLISHED' });
    for (const [t, tm] of [[issueType, issueTmpl], [xferType, xferTmpl], [promoteType, promoteTmpl], [disbType, disbTmpl], [whOnlyType, whOnlyTmpl], [pastType, pastTmpl]] as const) {
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
      pastType: pastType.id, pastTmpl: pastTmpl.id,
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
    // Submitting and approving need a signature on file; not this spec's subject, so everyone gets one.
    await signAllUsers(orm.em);
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

  // ---- Currency ------------------------------------------------------------------

  /**
   * The currency is the one correctable selection no `document_type` flag asks for, and it strands
   * a draft for a different reason than the others do. Nothing makes it required; it is simply
   * wrong, and a draft whose currency is wrong states every line amount in the wrong unit. The
   * approver returns it saying the amount is wrong — REC-HAL-2026-0026 was returned four times that
   * way — and the one correction that answers them was the one the document could not carry. The
   * only exit was to cancel it and lose its doc_no and its approval_log.
   */
  it('corrects a draft raised in the wrong currency, leaving the amounts alone', async () => {
    const id = await draft(ids.disbType, ids.disbTmpl, { currency: 'LAK' });

    await asUser(() => documents.setSelections(id, { currency: 'THB' }));

    const d = await reload(id);
    expect(d.currency?.code).toBe('THB');
    // The numbers are the correction's whole point: 14,000 was always baht. Restating the unit is
    // what was asked for; converting the amounts would be a different act nobody requested.
    expect(d.totalAmount).toBe('1000.00');
    // Invariant 6: no rate is resolved or stamped here. Submit does that, from whatever currency
    // the document names at that moment.
    expect(d.exchangeRate).toBe('1.00000000');
  });

  it('accepts a lowercase code, as create does', async () => {
    const id = await draft(ids.disbType, ids.disbTmpl, { currency: 'LAK' });

    await asUser(() => documents.setSelections(id, { currency: 'thb' }));

    expect((await reload(id)).currency?.code).toBe('THB');
  });

  it('refuses the currency once the document has left DRAFT', async () => {
    for (const status of [DocStatus.IN_APPROVAL, DocStatus.COMPLETED]) {
      const id = await draft(ids.disbType, ids.disbTmpl, { status, currency: 'LAK' });

      await expect(asUser(() => documents.setSelections(id, { currency: 'THB' }))).rejects.toThrow();

      expect((await reload(id)).currency?.code).toBe('LAK');
    }
  });

  it('refuses an unknown currency code and leaves the document unchanged', async () => {
    const id = await draft(ids.disbType, ids.disbTmpl, { currency: 'LAK' });

    await expect(asUser(() => documents.setSelections(id, { currency: 'ZZZ' }))).rejects.toThrow();

    expect((await reload(id)).currency?.code).toBe('LAK');
  });

  it('refuses an inactive currency and leaves the document unchanged', async () => {
    // The same reach every other selection is held to: only what could have been chosen at
    // creation. The wizard's picker offers the active currencies, so a retired one is not a
    // correction of the creation — the creation could not have held it either.
    const id = await draft(ids.disbType, ids.disbTmpl, { currency: 'LAK' });

    await expect(asUser(() => documents.setSelections(id, { currency: 'XXX' }))).rejects.toThrow(
      BadRequestException,
    );

    expect((await reload(id)).currency?.code).toBe('LAK');
  });

  it('refuses to clear the currency', async () => {
    // Absent means "leave alone" for every selection. Explicit null means "clear" for the others,
    // but clearing a currency restates every line amount against the company base without touching
    // the numbers — never what a correction of a mis-stated currency intends.
    const id = await draft(ids.disbType, ids.disbTmpl, { currency: 'LAK' });

    await expect(
      asUser(() => documents.setSelections(id, { currency: null as unknown as string })),
    ).rejects.toThrow(BadRequestException);

    expect((await reload(id)).currency?.code).toBe('LAK');
  });

  it('leaves the currency alone when the key is absent', async () => {
    const id = await draft(ids.disbType, ids.disbTmpl, { currency: 'LAK' });

    await asUser(() => documents.setSelections(id, { vendorId: ids.vendor }));

    expect((await reload(id)).currency?.code).toBe('LAK');
  });

  it('resubmits at a rate resolved from the corrected currency', async () => {
    // The invariant-6 half of this change. Correcting a draft's currency stamps nothing; it changes
    // which currency the NEXT submit resolves its rate from. A draft returned by an approver for a
    // wrong amount is exactly the document this has to hold for.
    const em = orm.em.fork();
    em.create(ExchangeRate, {
      company: undefined,
      fromCurrency: em.getReference(Currency, 'LAK'),
      toCurrency: em.getReference(Currency, 'THB'),
      rate: '0.00144928',
      rateDate: new Date().toISOString().slice(0, 10),
      rateType: 'DAILY',
    });
    await em.flush();

    const id = await draft(ids.disbType, ids.disbTmpl, { vendor: ids.vendor, payee: ids.payee });
    expect((await reload(id)).exchangeRate).toBe('1.00000000');

    await asUser(() => documents.setSelections(id, { currency: 'LAK' }));
    // Still unstamped: the correction resolved nothing.
    expect((await reload(id)).exchangeRate).toBe('1.00000000');

    await asUser(() => submit.submit(id));

    expect((await reload(id)).exchangeRate).toBe('0.00144928');
  });

  it('writes neither the warehouse nor the currency when one of them is bad', async () => {
    // The all-or-nothing property this route already promises, now that one request can carry a
    // currency too: everything is resolved before anything is assigned.
    const id = await draft(ids.whOnlyType, ids.whOnlyTmpl, { currency: 'LAK' });

    await expect(
      asUser(() => documents.setSelections(id, { warehouseId: ids.mainWh, currency: 'XXX' })),
    ).rejects.toThrow(BadRequestException);

    const d = await reload(id);
    expect(d.warehouse).toBeFalsy();
    expect(d.currency?.code).toBe('LAK');
  });

  // ---- Day money moved -------------------------------------------------------------

  /**
   * `money_moved_on` is the `txn_date` of every budget_txn row the document writes, so it decides
   * which PERIOD the spend reports in. Nothing at submit requires it, which is what made losing it
   * the worst of this family of bugs: the document completed normally and simply reported its
   * spend in the wrong month, with no refusal anywhere to draw attention to it.
   */
  it("corrects a draft's day when the caller may backdate", async () => {
    const id = await draft(ids.pastType, ids.pastTmpl, { moneyMovedOn: daysAgo(30) });

    await asUserWith(['DOC_BACKDATE'], () =>
      documents.setMoneyMovedOn(id, daysAgo(10)),
    );

    expect((await reload(id)).moneyMovedOn).toBe(daysAgo(10));
  });

  it('dates the budget rows at submit from the corrected day', async () => {
    // The reason the column matters, asserted rather than assumed.
    const id = await draft(ids.pastType, ids.pastTmpl, { moneyMovedOn: daysAgo(30) });
    await asUserWith(['DOC_BACKDATE'], () => documents.setMoneyMovedOn(id, daysAgo(10)));

    await asUser(() => submit.submit(id));

    const rows = await orm.em.fork().find(BudgetTxn, { document: id }, FILTER_OFF);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.txnDate).toBe(daysAgo(10));
  });

  it('refuses the day once the document has left DRAFT, altering no ledger row', async () => {
    for (const status of [DocStatus.IN_APPROVAL, DocStatus.COMPLETED]) {
      const id = await draft(ids.pastType, ids.pastTmpl, { status, moneyMovedOn: daysAgo(30) });

      await expect(
        asUserWith(['DOC_BACKDATE'], () => documents.setMoneyMovedOn(id, daysAgo(1))),
      ).rejects.toThrow();

      expect((await reload(id)).moneyMovedOn).toBe(daysAgo(30));
      expect(await orm.em.fork().count(BudgetTxn, { document: id }, FILTER_OFF)).toBe(0);
    }
  });

  it('refuses a type that does not record past events', async () => {
    const id = await draft(ids.disbType, ids.disbTmpl);

    await expect(
      asUserWith(['DOC_BACKDATE'], () => documents.setMoneyMovedOn(id, daysAgo(1))),
    ).rejects.toThrow(BadRequestException);

    expect((await reload(id)).moneyMovedOn).toBeFalsy();
  });

  it('refuses a day in the future', async () => {
    const id = await draft(ids.pastType, ids.pastTmpl, { moneyMovedOn: daysAgo(30) });

    await expect(
      asUserWith(['DOC_BACKDATE'], () => documents.setMoneyMovedOn(id, daysAhead(1))),
    ).rejects.toThrow(BadRequestException);

    expect((await reload(id)).moneyMovedOn).toBe(daysAgo(30));
  });

  it('refuses a past day from a caller without DOC_BACKDATE', async () => {
    const id = await draft(ids.pastType, ids.pastTmpl, { moneyMovedOn: daysAgo(30) });

    await expect(asUser(() => documents.setMoneyMovedOn(id, daysAgo(1)))).rejects.toThrow(
      ForbiddenException,
    );

    expect((await reload(id)).moneyMovedOn).toBe(daysAgo(30));
  });

  it('lets a caller WITHOUT DOC_BACKDATE clear the day', async () => {
    // Clearing has no day to be in the future and no past day to backdate, so the guard has
    // nothing to check. Requiring the permission to REMOVE a date would strand exactly the drafts
    // that need to drop one: those of a type that has since lost `records_past_events`.
    const id = await draft(ids.pastType, ids.pastTmpl, { moneyMovedOn: daysAgo(30) });

    await asUser(() => documents.setMoneyMovedOn(id, null));

    expect((await reload(id)).moneyMovedOn).toBeFalsy();
  });

  // ---- Ledger --------------------------------------------------------------------

  it('writes no budget row', async () => {
    // Why there is no concurrency test here: this flow writes neither budget_txn nor quota_usage
    // and takes no lock. It is refused outside DRAFT, which is before submit reserves anything, so
    // no reservation exists for a corrected document and there is nothing to race against. The
    // currency is no exception: correcting it stamps no rate and moves no hold — it only changes
    // which currency the later submit resolves from, under that submit's own locks.
    const id = await draft(ids.issueType, ids.issueTmpl);

    await asUser(() => documents.setSelections(id, { warehouseId: ids.mainWh }));

    expect(await orm.em.fork().count(BudgetTxn, { document: id }, FILTER_OFF)).toBe(0);
  });
});
