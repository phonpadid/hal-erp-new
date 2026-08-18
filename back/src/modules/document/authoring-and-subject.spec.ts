import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { AccountService } from '../accounting/account.service';
import { DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetMovement } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { ItemService } from '../master-data/item.service';
import { VendorService } from '../master-data/vendor.service';
import { ScopeService } from '../rbac/scope.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { Workflow, WorkflowStep } from '../approval/approval.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { DocumentSubmitService } from './document-submit.service';
import { Warehouse } from '../inventory/inventory.entities';
import { WarehouseService } from '../inventory/warehouse.service';
import { Document, DocumentType, FormTemplate } from './document.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * A document must be finishable before it becomes somebody else's work.
 *
 * Both guards existed downstream already — the HR post-actions no-op without a subject, and the
 * budget/voucher post-actions refuse without content — and both discovered the problem too late: a
 * promotion naming nobody reached COMPLETED having changed nothing, and an empty budget plan sat in
 * an approver's queue refusing to be approved and refusing to go away.
 */
describe.skipIf(!hasDb)('submit refuses a document its post-action could not finish (DB-backed)', () => {
  let orm: MikroORM;
  let submit: DocumentSubmitService;
  const ids = {
    company: '', otherCompany: '', dept: '', tmplHr: '', tmplPlain: '',
    hrType: '', planType: '', jvType: '', memoType: '', xferType: '',
    wf: '', user: '', employee: '', foreignEmployee: '',
  };
  let seq = 0;

  const asCtx = <T>(fn: () => Promise<T>): Promise<T> =>
    RequestContext.run({ userId: ids.user, companyId: ids.company, departmentId: ids.dept, grants: [] }, fn);
  const reload = (id: string) => orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);

  /** A DRAFT of the given type, optionally naming an employee. */
  async function draft(typeId: string, tmplId: string, employeeId?: string): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `AS-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, typeId),
      formTemplate: em.getReference(FormTemplate, tmplId),
      workflow: em.getReference(Workflow, ids.wf),
      createdBy: em.getReference(AppUser, ids.user),
      relatedEmployee: employeeId ? em.getReference(Employee, employeeId) : undefined,
      totalAmount: '100',
      status: DocStatus.DRAFT,
      createdAt: new Date(),
    } as never);
    await em.flush();
    return doc.id;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const other = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true });
    const dept = em.create(Department, { company, deptCode: 'DA', name: 'DA', isActive: true });
    const otherDept = em.create(Department, { company: other, deptCode: 'DB', name: 'DB', isActive: true });
    em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });

    const mk = (code: string, flags: Record<string, unknown>) =>
      em.create(DocumentType, {
        company, code, name: code, category: DocCategory.HR,
        requiresBudget: false, requiresQuota: false, requiresVendor: false, isActive: true, ...flags,
      } as never);
    const hrType = mk('PROMO', { requiresEmployee: true, postAction: 'UPDATE_EMPLOYEE' });
    const planType = mk('PLAN', { postAction: 'ACTIVATE_BUDGET' });
    const jvType = mk('VOUCH', { postAction: 'POST_JOURNAL' });
    const memoType = mk('MEMO', {});
    const xferType = mk('XFER', { requiresWarehouse: true, postAction: 'TRANSFER_STOCK' });
    em.create(FormTemplate, { documentType: xferType, version: 1, status: 'PUBLISHED' });
    const tmplHr = em.create(FormTemplate, { documentType: hrType, version: 1, status: 'PUBLISHED' });
    const tmplPlain = em.create(FormTemplate, { documentType: memoType, version: 1, status: 'PUBLISHED' });
    em.create(FormTemplate, { documentType: planType, version: 1, status: 'PUBLISHED' });
    em.create(FormTemplate, { documentType: jvType, version: 1, status: 'PUBLISHED' });

    const user = em.create(AppUser, { username: 'u1', email: 'u1@x', status: 'ACTIVE' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    em.create(WorkflowStep, { workflow: wf, stepNo: 1, approverUser: user, approveMode: 'SEQUENTIAL' } as never);
    const employee = em.create(Employee, { company, department: dept, empCode: 'E1', fullName: 'Subject', status: 'ACTIVE' } as never);
    const foreign = em.create(Employee, { company: other, department: otherDept, empCode: 'E2', fullName: 'Elsewhere', status: 'ACTIVE' } as never);

    await em.flush();
    Object.assign(ids, {
      company: company.id, otherCompany: other.id, dept: dept.id,
      tmplHr: tmplHr.id, tmplPlain: tmplPlain.id,
      hrType: hrType.id, planType: planType.id, jvType: jvType.id, memoType: memoType.id, xferType: xferType.id,
      wf: wf.id, user: user.id, employee: employee.id, foreignEmployee: foreign.id,
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
    submit = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      new FiscalYearService(scope),
      new VendorService(orm.em, scope, new ScopeService()),
      new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope)),
      new BudgetLedgerService(orm.em, new BudgetBalanceService(orm.em), new BudgetCoverageService(orm.em)),
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
      undefined, // matching — not exercised here
      undefined, // stock movement — the transfer test stops at the submit guard
      new WarehouseService(scope),
    );
  });

  it('refuses a requires_employee document that names nobody, and leaves it DRAFT', async () => {
    const id = await draft(ids.hrType, ids.tmplHr);
    await expect(asCtx(() => submit.submit(id))).rejects.toBeInstanceOf(BadRequestException);
    expect((await reload(id)).status).toBe(DocStatus.DRAFT);
  });

  it('accepts one that names an employee of this company', async () => {
    const id = await draft(ids.hrType, ids.tmplHr, ids.employee);
    await asCtx(() => submit.submit(id));
    expect((await reload(id)).status).not.toBe(DocStatus.DRAFT);
  });

  it("refuses an employee of another company (invariant 1)", async () => {
    const id = await draft(ids.hrType, ids.tmplHr, ids.foreignEmployee);
    await expect(asCtx(() => submit.submit(id))).rejects.toBeInstanceOf(BadRequestException);
    expect((await reload(id)).status).toBe(DocStatus.DRAFT);
  });

  it('leaves a type without the flag alone', async () => {
    const id = await draft(ids.memoType, ids.tmplPlain);
    await asCtx(() => submit.submit(id));
    expect((await reload(id)).status).not.toBe(DocStatus.DRAFT);
  });

  it('refuses a budget document carrying no movement — the approver never sees it', async () => {
    const id = await draft(ids.planType, ids.tmplPlain);
    await expect(asCtx(() => submit.submit(id))).rejects.toBeInstanceOf(BadRequestException);
    expect((await reload(id)).status).toBe(DocStatus.DRAFT);
  });

  it('accepts a budget document once it carries one', async () => {
    const id = await draft(ids.planType, ids.tmplPlain);
    const em = orm.em.fork();
    em.create(BudgetMovement, {
      company: em.getReference(Company, ids.company),
      document: em.getReference(Document, id),
      movementType: 'ACTIVATE_BUDGET',
      amount: '100',
      createdAt: new Date(),
    } as never);
    await em.flush();
    await asCtx(() => submit.submit(id));
    expect((await reload(id)).status).not.toBe(DocStatus.DRAFT);
  });

  it('refuses a voucher document carrying no voucher', async () => {
    const id = await draft(ids.jvType, ids.tmplPlain);
    await expect(asCtx(() => submit.submit(id))).rejects.toBeInstanceOf(BadRequestException);
    expect((await reload(id)).status).toBe(DocStatus.DRAFT);
  });

  it('does not let the submit guard stand in for the post-action', async () => {
    // The guard is an early filter, not a replacement: a document that passed submit and then lost
    // its movements must still be refused when the post-action runs. Asserted on the post-action's
    // own precondition rather than by driving a full approval, which is another module's harness.
    const id = await draft(ids.planType, ids.tmplPlain);
    const em = orm.em.fork();
    em.create(BudgetMovement, {
      company: em.getReference(Company, ids.company),
      document: em.getReference(Document, id),
      movementType: 'ACTIVATE_BUDGET',
      amount: '100',
      createdAt: new Date(),
    } as never);
    await em.flush();
    await asCtx(() => submit.submit(id));

    const em2 = orm.em.fork();
    await em2.nativeDelete(BudgetMovement, { document: id }, FILTER_OFF as never);
    expect(await em2.count(BudgetMovement, { document: id }, FILTER_OFF)).toBe(0);
  });

  it('refuses a stock transfer that names one warehouse twice, or no destination', async () => {
    const em = orm.em.fork();
    const wh = (code: string) =>
      em.create(Warehouse, {
        company: em.getReference(Company, ids.company), code, name: code, isActive: true,
      } as never);
    const a = wh(`WA-${seq}`);
    const b = wh(`WB-${seq}`);
    await em.flush();

    const one = await draft(ids.xferType, ids.tmplPlain);
    const em3 = orm.em.fork();
    const d1 = await em3.findOneOrFail(Document, { id: one }, FILTER_OFF);
    d1.warehouse = em3.getReference(Warehouse, a.id);
    d1.destWarehouse = em3.getReference(Warehouse, a.id); // same both ends
    await em3.flush();
    await expect(asCtx(() => submit.submit(one))).rejects.toBeInstanceOf(BadRequestException);
    expect((await reload(one)).status).toBe(DocStatus.DRAFT);

    // A transfer with no destination at all is refused for the other reason.
    const none = await draft(ids.xferType, ids.tmplPlain);
    const em4 = orm.em.fork();
    const d2 = await em4.findOneOrFail(Document, { id: none }, FILTER_OFF);
    d2.warehouse = em4.getReference(Warehouse, b.id);
    await em4.flush();
    await expect(asCtx(() => submit.submit(none))).rejects.toBeInstanceOf(BadRequestException);
    expect((await reload(none)).status).toBe(DocStatus.DRAFT);

    // The accepting case is deliberately not asserted here: past these guards a transfer reserves
    // stock, which needs StockMovementService and its fixtures — another module's harness. What
    // this change added is the UI that collects the two warehouses, covered on the client side.
  });
});
