import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { Currency } from '../currency/currency.entities';
import { Vendor } from '../master-data/master-data.entities';
import { Workflow } from '../approval/approval.entities';
import { PostActionService } from '../approval/post-action.service';
import { Document, DocumentLine, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetTxn } from '../budget/budget.entities';
import { PaymentHandoffService } from './payment-handoff.service';
import { PaymentService } from './payment.service';
import { Payment } from './payment.entities';
import { TaxCode } from '../tax/tax.entities';
import { TaxKind } from '../../common/enums';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('payment handoff: ready-to-pay queue (DB-backed)', () => {
  let orm: MikroORM;
  const ids = { coA: '', coB: '', deptA: '', deptB: '', user: '', cutType: '', plainType: '', cutTmpl: '', plainTmpl: '', wf: '', vendor: '', wht3: '', vat7: '' };
  let seq = 0;

  async function completedDoc(companyId: string, deptId: string, typeId: string, tmplId: string, opts: { base?: string; total?: string; rate?: string; gl?: string; vendor?: boolean; baseTaxTotal?: string } = {}): Promise<string> {
    const em = orm.em.fork();
    const d = em.create(Document, {
      docNo: `D-${seq++}`,
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, deptId),
      documentType: em.getReference(DocumentType, typeId),
      formTemplate: em.getReference(FormTemplate, tmplId),
      workflow: em.getReference(Workflow, ids.wf),
      createdBy: em.getReference(AppUser, ids.user),
      vendor: opts.vendor ? em.getReference(Vendor, ids.vendor) : undefined,
      exchangeRate: opts.rate ?? '1',
      totalAmount: opts.total ?? opts.base,
      baseTotalAmount: opts.base,
      baseTaxTotal: opts.baseTaxTotal,
      status: DocStatus.COMPLETED,
      createdAt: new Date(),
    });
    if (opts.gl) em.create(DocumentLine, { document: d, lineNo: 1, description: 'X', qty: '1', unitPrice: '1', lineAmount: opts.base ?? '0', glAccount: opts.gl });
    await em.flush();
    return d.id;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const coA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const coB = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true });
    const deptA = em.create(Department, { company: coA, deptCode: 'DA', name: 'DA', isActive: true });
    const deptB = em.create(Department, { company: coB, deptCode: 'DB', name: 'DB', isActive: true });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const cutType = em.create(DocumentType, { code: 'DISB', name: 'Disb', category: DocCategory.FINANCE, requiresBudget: false, requiresQuota: false, postAction: 'CUT_BUDGET', isActive: true });
    const plainType = em.create(DocumentType, { code: 'MEMO', name: 'Memo', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, isActive: true });
    const cutTmpl = em.create(FormTemplate, { documentType: cutType, version: 1, status: 'PUBLISHED' });
    const plainTmpl = em.create(FormTemplate, { documentType: plainType, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company: coA, name: 'WF', isActive: true });
    const vendor = em.create(Vendor, { vendorCode: 'V1', name: 'Acme', isActive: true });
    const wht3 = em.create(TaxCode, { company: coA, code: 'WHT3', name: 'WHT 3%', kind: TaxKind.WHT, rate: '0.03', isActive: true });
    const vat7 = em.create(TaxCode, { company: coA, code: 'VAT7', name: 'VAT 7%', kind: TaxKind.VAT, rate: '0.07', isActive: true });
    await em.flush();
    Object.assign(ids, {
      coA: coA.id, coB: coB.id, deptA: deptA.id, deptB: deptB.id, user: user.id,
      cutType: cutType.id, plainType: plainType.id, cutTmpl: cutTmpl.id, plainTmpl: plainTmpl.id, wf: wf.id, vendor: vendor.id,
      wht3: wht3.id, vat7: vat7.id,
    });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('lists settled CUT_BUDGET documents with vendor, amount, and GL — company-scoped', async () => {
    const payId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { base: '500', gl: 'GL1', vendor: true });
    await completedDoc(ids.coA, ids.deptA, ids.plainType, ids.plainTmpl, { base: '999' }); // not CUT_BUDGET → excluded
    await completedDoc(ids.coB, ids.deptB, ids.cutType, ids.cutTmpl, { base: '700', gl: 'GL9' }); // other company → excluded

    const svc = new PaymentHandoffService(orm.em, new CompanyScopeService(orm.em));
    const queue = await RequestContext.run({ userId: ids.user, companyId: ids.coA, departmentId: ids.deptA, grants: [] }, () => svc.readyToPay());

    expect(queue).toHaveLength(1);
    expect(queue[0].documentId).toBe(payId);
    expect(queue[0].vendorName).toBe('Acme');
    expect(Number(queue[0].baseAmount)).toBe(500);
    expect(queue[0].glAccounts).toEqual(['GL1']);
  });

  it('signals payment-ready when a CUT_BUDGET document settles', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { base: '0' }); // no budgeted lines
    const postAction = new PostActionService(new BudgetLedgerService(orm.em, new BudgetBalanceService(orm.em)), orm.em);
    const doc = await orm.em.fork().findOneOrFail(Document, { id: docId }, { ...FILTER_OFF, populate: ['documentType'] });

    const result = await RequestContext.run(
      { userId: ids.user, companyId: ids.coA, departmentId: ids.deptA, grants: [] },
      () => orm.em.fork().transactional((tem: EntityManager) => postAction.run(doc, tem)),
    );
    expect(result.paymentReady).toBe(true);
  });

  // ---- Record payment + FX gain/loss ----------------------------------------

  const asA = <T>(fn: () => Promise<T>): Promise<T> =>
    RequestContext.run({ userId: ids.user, companyId: ids.coA, departmentId: ids.deptA, grants: [] }, fn);

  it('records an FX loss when paid at a worse rate, emits, and writes no budget_txn', async () => {
    // Locked at rate 1.0 (base 100000); pay at 1.05 → base actual 105000 → loss 5000.
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100000', rate: '1', base: '100000', vendor: true });
    const events = { emit: vi.fn() } as any;
    const svc = new PaymentService(orm.em, events);

    const r = await asA(() => svc.record(docId, '1.05'));
    expect(r.fxKind).toBe('LOSS');
    expect(Number(r.fxDelta)).toBe(5000);
    expect(Number(r.baseActual)).toBe(105000);
    expect(events.emit).toHaveBeenCalledWith('payment.settled', expect.objectContaining({ documentId: docId, fxKind: 'LOSS' }));

    const payment = await orm.em.fork().findOneOrFail(Payment, { document: docId }, FILTER_OFF);
    expect(payment.fxKind).toBe('LOSS');
    const txns = await orm.em.fork().find(BudgetTxn, { document: docId }, FILTER_OFF);
    expect(txns).toHaveLength(0); // FX never touches the budget ledger
  });

  it('records no FX when paid in the base currency', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '500', rate: '1', base: '500' });
    const r = await asA(() => new PaymentService(orm.em).record(docId, '1'));
    expect(r.fxKind).toBe('NONE');
    expect(Number(r.fxDelta)).toBe(0);
  });

  it('rejects a second payment for the same disbursement', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    const svc = new PaymentService(orm.em);
    await asA(() => svc.record(docId, '1'));
    await expect(asA(() => svc.record(docId, '1'))).rejects.toThrow(/already/i);
  });

  it('removes a paid disbursement from the ready-to-pay queue', async () => {
    const FILTER = new CompanyScopeService(orm.em);
    const handoff = new PaymentHandoffService(orm.em, FILTER);
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '777', rate: '1', base: '777', gl: 'GLX' });
    const before = await asA(() => handoff.readyToPay());
    expect(before.some((p) => p.documentId === docId)).toBe(true);

    await asA(() => new PaymentService(orm.em).record(docId, '1'));
    const after = await asA(() => handoff.readyToPay());
    expect(after.some((p) => p.documentId === docId)).toBe(false);
  });

  it('rejects recording a payment on a non-disbursement document', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.plainType, ids.plainTmpl, { total: '10', base: '10' });
    await expect(asA(() => new PaymentService(orm.em).record(docId, '1'))).rejects.toThrow(/disbursement/i);
  });

  it('withholds WHT and pays the vendor net', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100000', rate: '1', base: '100000', vendor: true });
    const r = await asA(() => new PaymentService(orm.em).record(docId, '1', ids.wht3));
    expect(r.whtAmount).toBe('3000.00'); // 3% of the 100000 net
    const pay = await orm.em.fork().findOneOrFail(Payment, { document: docId }, FILTER_OFF);
    expect(Number(pay.whtAmount)).toBe(3000);
    // Cash paid to the vendor = base actual − WHT = 100000 − 3000 = 97000 (derived).
    expect(Number(pay.baseActual) - Number(pay.whtAmount)).toBe(97000);
  });

  it('withholds WHT on the pre-VAT net (excludes VAT)', async () => {
    // base 107000 incl VAT 7000 → net base 100000 → WHT 3% = 3000.
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '107000', rate: '1', base: '107000', baseTaxTotal: '7000', vendor: true });
    const r = await asA(() => new PaymentService(orm.em).record(docId, '1', ids.wht3));
    expect(r.whtAmount).toBe('3000.00');
  });

  it('rejects a VAT-kind code used as WHT', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100000', rate: '1', base: '100000', vendor: true });
    await expect(asA(() => new PaymentService(orm.em).record(docId, '1', ids.vat7))).rejects.toThrow(/not a WHT code/i);
  });

  it('withholds nothing when no WHT code is given', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100000', rate: '1', base: '100000', vendor: true });
    const r = await asA(() => new PaymentService(orm.em).record(docId, '1'));
    expect(r.whtAmount).toBe('0');
  });

  it('derives base_actual from base_locked for a line-based doc (total_amount null)', async () => {
    // Line-based documents leave total_amount null; base_actual must come from base_locked, not a
    // null total (which would yield 0 and a phantom full-amount FX).
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `LB-${seq++}`,
      company: em.getReference(Company, ids.coA), department: em.getReference(Department, ids.deptA),
      documentType: em.getReference(DocumentType, ids.cutType), formTemplate: em.getReference(FormTemplate, ids.cutTmpl),
      workflow: em.getReference(Workflow, ids.wf), createdBy: em.getReference(AppUser, ids.user),
      exchangeRate: '1', baseTotalAmount: '37000', status: DocStatus.COMPLETED, createdAt: new Date(),
    });
    await em.flush();

    const r = await asA(() => new PaymentService(orm.em).record(doc.id, '1'));
    expect(Number(r.baseActual)).toBe(37000); // = base_locked, not 0
    expect(Number(r.fxDelta)).toBe(0);
    expect(r.fxKind).toBe('NONE');
  });

  it('re-rates base_actual at the actual rate for a line-based doc', async () => {
    // base_locked 37000 at locked rate 1; pay at 1.1 → base_actual 40700, FX loss 3700.
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `LB-${seq++}`,
      company: em.getReference(Company, ids.coA), department: em.getReference(Department, ids.deptA),
      documentType: em.getReference(DocumentType, ids.cutType), formTemplate: em.getReference(FormTemplate, ids.cutTmpl),
      workflow: em.getReference(Workflow, ids.wf), createdBy: em.getReference(AppUser, ids.user),
      exchangeRate: '1', baseTotalAmount: '37000', status: DocStatus.COMPLETED, createdAt: new Date(),
    });
    await em.flush();

    const r = await asA(() => new PaymentService(orm.em).record(doc.id, '1.1'));
    expect(Number(r.baseActual)).toBe(40700);
    expect(Number(r.fxDelta)).toBe(3700);
    expect(r.fxKind).toBe('LOSS');
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[payment-handoff] no database reachable — skipping DB-backed spec');
}
