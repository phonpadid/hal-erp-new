import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Vendor, VendorBankAccount } from '../master-data/master-data.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { QuotaUsage } from '../quota/quota.entities';
import { Workflow } from '../approval/approval.entities';
import { PaymentBatchService } from './payment-batch.service';
import { PaymentHandoffService } from './payment-handoff.service';
import { PaymentBatch, PaymentBatchLine } from './payment.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Building a payment run, and the queue rule that keeps a payable out of two of them.
 */
describe.skipIf(!hasDb)('payment batch: build + queue (DB-backed)', () => {
  let orm: MikroORM;
  let batches: PaymentBatchService;
  let handoff: PaymentHandoffService;

  const ids = {
    company: '', otherCompany: '', dept: '', otherDept: '', user: '', wf: '',
    vendor: '', account: '', disbType: '', otherDisbType: '', tmpl: '', otherTmpl: '',
  };
  let seq = 0;

  function asUser<T>(fn: () => Promise<T>, companyId = ids.company): Promise<T> {
    return RequestContext.run(
      { userId: ids.user, companyId, departmentId: ids.dept, grants: [] },
      fn,
    );
  }

  /** A settled disbursement: COMPLETED, CUT_BUDGET, with a payee — i.e. payable. */
  async function payable(over: { company?: string; dept?: string; type?: string; tmpl?: string; status?: DocStatus; payee?: boolean } = {}): Promise<string> {
    const em = orm.em.fork();
    const d = em.create(Document, {
      docNo: `P-${seq++}`,
      company: em.getReference(Company, over.company ?? ids.company),
      department: em.getReference(Department, over.dept ?? ids.dept),
      documentType: em.getReference(DocumentType, over.type ?? ids.disbType),
      formTemplate: em.getReference(FormTemplate, over.tmpl ?? ids.tmpl),
      workflow: em.getReference(Workflow, ids.wf),
      currentStepNo: 1,
      createdBy: em.getReference(AppUser, ids.user),
      vendor: em.getReference(Vendor, ids.vendor),
      vendorBankAccount: over.payee === false ? undefined : em.getReference(VendorBankAccount, ids.account),
      exchangeRate: '1',
      totalAmount: '1000.00',
      baseTotalAmount: '1000.00',
      status: over.status ?? DocStatus.COMPLETED,
      approvedAt: new Date(),
      createdAt: new Date(),
    });
    await em.flush();
    return d.id;
  }

  function queueIds(): Promise<string[]> {
    return asUser(async () => (await handoff.readyToPay()).map((p) => p.documentId));
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();

    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const otherCompany = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true });
    const dept = em.create(Department, { company, deptCode: 'D', name: 'D', isActive: true });
    const otherDept = em.create(Department, { company: otherCompany, deptCode: 'D2', name: 'D2', isActive: true });
    const user = em.create(AppUser, { username: 'fin', email: 'fin@x', status: 'ACTIVE' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });

    const vendor = em.create(Vendor, { vendorCode: 'V1', name: 'Acme', paymentTermDays: 30, isActive: true });
    const account = em.create(VendorBankAccount, { vendor, bankCode: 'BKK', accountNo: '0001', accountName: 'Acme Co', isPrimary: true, isActive: true });

    const disbType = em.create(DocumentType, { company, code: 'DISB', name: 'Disb', category: DocCategory.FINANCE, requiresBudget: false, requiresQuota: false, requiresVendor: true, requiresItem: false, requiresPayee: true, requiresWarehouse: false, postAction: 'CUT_BUDGET', isActive: true });
    const otherDisbType = em.create(DocumentType, { company: otherCompany, code: 'DISB', name: 'Disb', category: DocCategory.FINANCE, requiresBudget: false, requiresQuota: false, requiresVendor: true, requiresItem: false, requiresPayee: true, requiresWarehouse: false, postAction: 'CUT_BUDGET', isActive: true });
    const tmpl = em.create(FormTemplate, { documentType: disbType, version: 1, status: 'PUBLISHED' });
    const otherTmpl = em.create(FormTemplate, { documentType: otherDisbType, version: 1, status: 'PUBLISHED' });
    await em.flush();

    Object.assign(ids, {
      company: company.id, otherCompany: otherCompany.id, dept: dept.id, otherDept: otherDept.id,
      user: user.id, wf: wf.id, vendor: vendor.id, account: account.id,
      disbType: disbType.id, otherDisbType: otherDisbType.id, tmpl: tmpl.id, otherTmpl: otherTmpl.id,
    });

    const scope = new CompanyScopeService(orm.em);
    handoff = new PaymentHandoffService(orm.em, scope);
    batches = new PaymentBatchService(orm.em, scope, handoff);
  });

  beforeEach(async () => {
    const em = orm.em.fork();
    await em.nativeDelete(PaymentBatchLine, {}, FILTER_OFF);
    await em.nativeDelete(PaymentBatch, {}, FILTER_OFF);
    await em.nativeDelete(Document, {}, FILTER_OFF);
  });

  // ---- Build -----------------------------------------------------------------

  it('builds a DRAFT batch with one line per payable', async () => {
    const a = await payable();
    const b = await payable();

    const batch = await asUser(() => batches.build({ documentIds: [a, b] }));

    expect(batch.status).toBe('DRAFT');
    const { lines } = await asUser(() => batches.get(batch.id));
    expect(lines).toHaveLength(2);
  });

  it('snapshots the payee, so a later account edit cannot rewrite the batch', async () => {
    const a = await payable();
    const batch = await asUser(() => batches.build({ documentIds: [a] }));

    // Re-point the vendor's account after the batch was built.
    const em = orm.em.fork();
    const account = await em.findOneOrFail(VendorBankAccount, { id: ids.account }, FILTER_OFF);
    account.accountNo = '9999';
    await em.flush();

    const { lines } = await asUser(() => batches.get(batch.id));
    // A live join here would make the stored file disagree with the database.
    expect(lines[0].accountNo).toBe('0001');

    account.accountNo = '0001';
    await orm.em.fork().nativeUpdate(VendorBankAccount, { id: ids.account }, { accountNo: '0001' }, FILTER_OFF);
  });

  it('rejects a document that is not COMPLETED', async () => {
    const draft = await payable({ status: DocStatus.DRAFT });

    await expect(asUser(() => batches.build({ documentIds: [draft] }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it("rejects another company's payable", async () => {
    const foreign = await payable({ company: ids.otherCompany, dept: ids.otherDept, type: ids.otherDisbType, tmpl: ids.otherTmpl });

    await expect(asUser(() => batches.build({ documentIds: [foreign] }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an empty batch', async () => {
    await expect(asUser(() => batches.build({ documentIds: [] }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('writes no budget or quota ledger row', async () => {
    const before = await orm.em.fork().count(BudgetTxn, {}, FILTER_OFF);
    const quotaBefore = await orm.em.fork().count(QuotaUsage, {}, FILTER_OFF);
    const a = await payable();

    await asUser(() => batches.build({ documentIds: [a] }));

    // The budget was settled when the document completed; touching it again would charge twice.
    expect(await orm.em.fork().count(BudgetTxn, {}, FILTER_OFF)).toBe(before);
    expect(await orm.em.fork().count(QuotaUsage, {}, FILTER_OFF)).toBe(quotaBefore);
  });

  // ---- The queue rule --------------------------------------------------------

  it('takes a batched payable off the queue, so it cannot be batched twice', async () => {
    const a = await payable();
    expect(await queueIds()).toContain(a);

    await asUser(() => batches.build({ documentIds: [a] }));

    // Without this, the same payable reaches the bank on two files and the payment unique
    // constraint only notices at import — after the money moved.
    expect(await queueIds()).not.toContain(a);
    await expect(asUser(() => batches.build({ documentIds: [a] }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('returns a cancelled batch’s payable to the queue with no requeue logic', async () => {
    const a = await payable();
    const batch = await asUser(() => batches.build({ documentIds: [a] }));
    expect(await queueIds()).not.toContain(a);

    await asUser(() => batches.cancel(batch.id));

    // The queue simply stops seeing a batch that is no longer open.
    expect(await queueIds()).toContain(a);
  });

  it('surfaces the approved payee on the queue', async () => {
    const a = await payable();

    const [row] = await asUser(() => handoff.readyToPay());

    expect(row.documentId).toBe(a);
    expect(row.payee).toMatchObject({ bankCode: 'BKK', accountNo: '0001', accountName: 'Acme Co' });
  });

  it('refuses to batch a payable with no payee', async () => {
    const a = await payable({ payee: false });

    await expect(asUser(() => batches.build({ documentIds: [a] }))).rejects.toThrow(/no payee/);
  });

  // ---- Cancel ----------------------------------------------------------------

  it('cancels a DRAFT batch', async () => {
    const a = await payable();
    const batch = await asUser(() => batches.build({ documentIds: [a] }));

    const cancelled = await asUser(() => batches.cancel(batch.id));

    expect(cancelled.status).toBe('CANCELLED');
  });

  it('refuses to cancel a COMPLETED batch', async () => {
    const a = await payable();
    const batch = await asUser(() => batches.build({ documentIds: [a] }));
    await orm.em.fork().nativeUpdate(PaymentBatch, { id: batch.id }, { status: 'COMPLETED' }, FILTER_OFF);

    // Its money is gone; "cancelling" it would be a lie.
    await expect(asUser(() => batches.cancel(batch.id))).rejects.toThrow(BadRequestException);
  });

  // ---- Company scope ---------------------------------------------------------

  it("hides another company's batch entirely", async () => {
    const a = await payable();
    const batch = await asUser(() => batches.build({ documentIds: [a] }));

    // Indistinguishable from one that does not exist.
    await expect(asUser(() => batches.get(batch.id), ids.otherCompany)).rejects.toThrow(
      NotFoundException,
    );
    await expect(asUser(() => batches.cancel(batch.id), ids.otherCompany)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('lists only the active company’s batches', async () => {
    const a = await payable();
    await asUser(() => batches.build({ documentIds: [a] }));

    expect(await asUser(() => batches.list())).toHaveLength(1);
    expect(await asUser(() => batches.list(), ids.otherCompany)).toHaveLength(0);
  });
});
