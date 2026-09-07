import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { fakeUpload } from '../../test/fake-upload';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { Currency } from '../currency/currency.entities';
import { Vendor } from '../master-data/master-data.entities';
import { Workflow } from '../approval/approval.entities';
import { PostActionService } from '../approval/post-action.service';
import { Document, DocumentLine, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetTxn } from '../budget/budget.entities';
import { PaymentAttachmentService } from './payment-attachment.service';
import { PaymentHandoffService } from './payment-handoff.service';
import { PaymentService } from './payment.service';
import { Payment, PaymentAttachment } from './payment.entities';
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

  /** Storage is stubbed: these assert scoping/permission/ledger behaviour, not S3. */
  const stubStorage = () => ({
    buildKey: (id: string, name: string) => `payments/${id}/${name}`,
    putObject: vi.fn().mockResolvedValue(undefined),
    presignDownload: vi.fn().mockResolvedValue('https://signed.example/x'),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  });

  /**
   * Evidence, which every hand-recorded payment now needs. Nothing here comes out of a bank batch,
   * so every `record` in this spec supplies one — the refusal without it has its own test.
   */
  const evidence = () =>
    (fakeUpload('slip.png', 'image/png', 1) as never);

  /** A payment service with storage stubbed, so a recorded payment can carry its evidence. */
  const paySvc = (events?: unknown, storage = stubStorage()) =>
    new PaymentService(orm.em, new CompanyScopeService(orm.em), storage as never, events as never);

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
    const cutType = em.create(DocumentType, { company: coA, code: 'DISB', name: 'Disb', category: DocCategory.FINANCE, requiresBudget: false, requiresQuota: false, postAction: 'CUT_BUDGET', isActive: true });
    const plainType = em.create(DocumentType, { company: coA, code: 'MEMO', name: 'Memo', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, isActive: true });
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
    const postAction = new PostActionService(new BudgetLedgerService(orm.em, new BudgetBalanceService(orm.em), new BudgetCoverageService(orm.em)), orm.em);
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
    const svc = paySvc(events);

    const r = await asA(() => svc.record(docId, { actualRate: '1.05', transferFrom: 'PRIMARY', file: evidence() }));
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
    const r = await asA(() => paySvc().record(docId, { actualRate: '1', transferFrom: 'PRIMARY', file: evidence() }));
    expect(r.fxKind).toBe('NONE');
    expect(Number(r.fxDelta)).toBe(0);
  });

  it('rejects a second payment for the same disbursement', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    const svc = paySvc();
    await asA(() => svc.record(docId, { actualRate: '1', transferFrom: 'PRIMARY', file: evidence() }));
    await expect(asA(() => svc.record(docId, { actualRate: '1', transferFrom: 'PRIMARY', file: evidence() }))).rejects.toThrow(/already/i);
  });

  it('removes a paid disbursement from the ready-to-pay queue', async () => {
    const FILTER = new CompanyScopeService(orm.em);
    const handoff = new PaymentHandoffService(orm.em, FILTER);
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '777', rate: '1', base: '777', gl: 'GLX' });
    const before = await asA(() => handoff.readyToPay());
    expect(before.some((p) => p.documentId === docId)).toBe(true);

    await asA(() => paySvc().record(docId, { actualRate: '1', transferFrom: 'PRIMARY', file: evidence() }));
    const after = await asA(() => handoff.readyToPay());
    expect(after.some((p) => p.documentId === docId)).toBe(false);
  });

  it('rejects recording a payment on a non-disbursement document', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.plainType, ids.plainTmpl, { total: '10', base: '10' });
    // Refused because the company does not owe it: nothing accrued a payable for it and its type
    // is not one the payment flow settles. The message names both, so the operator learns which.
    await expect(
      asA(() => paySvc().record(docId, { actualRate: '1', transferFrom: 'PRIMARY', file: evidence() })),
    ).rejects.toThrow(/is not something the company owes/i);
  });

  it('withholds WHT and pays the vendor net', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100000', rate: '1', base: '100000', vendor: true });
    const r = await asA(() => paySvc().record(docId, { actualRate: '1', transferFrom: 'PRIMARY', whtTaxCodeId: ids.wht3, file: evidence() }));
    expect(r.whtAmount).toBe('3000.00'); // 3% of the 100000 net
    const pay = await orm.em.fork().findOneOrFail(Payment, { document: docId }, FILTER_OFF);
    expect(Number(pay.whtAmount)).toBe(3000);
    // Cash paid to the vendor = base actual − WHT = 100000 − 3000 = 97000 (derived).
    expect(Number(pay.baseActual) - Number(pay.whtAmount)).toBe(97000);
  });

  it('withholds WHT on the pre-VAT net (excludes VAT)', async () => {
    // The lane marker for the change that made the BUDGET basis tax-inclusive: withholding is
    // computed on the net, and moving one basis must not drag the other with it. These are two
    // different questions — what the company spends, and what it withholds on behalf of the
    // revenue department — and they answer to different figures.
    // base 107000 incl VAT 7000 → net base 100000 → WHT 3% = 3000.
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '107000', rate: '1', base: '107000', baseTaxTotal: '7000', vendor: true });
    const r = await asA(() => paySvc().record(docId, { actualRate: '1', transferFrom: 'PRIMARY', whtTaxCodeId: ids.wht3, file: evidence() }));
    expect(r.whtAmount).toBe('3000.00');
  });

  it('rejects a VAT-kind code used as WHT', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100000', rate: '1', base: '100000', vendor: true });
    await expect(asA(() => paySvc().record(docId, { actualRate: '1', transferFrom: 'PRIMARY', whtTaxCodeId: ids.vat7, file: evidence() }))).rejects.toThrow(/not a WHT code/i);
  });

  it('withholds nothing when no WHT code is given', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100000', rate: '1', base: '100000', vendor: true });
    const r = await asA(() => paySvc().record(docId, { actualRate: '1', transferFrom: 'PRIMARY', file: evidence() }));
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

    const r = await asA(() => paySvc().record(doc.id, { actualRate: '1', transferFrom: 'PRIMARY', file: evidence() }));
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

    const r = await asA(() => paySvc().record(doc.id, { actualRate: '1.1', transferFrom: 'PRIMARY', file: evidence() }));
    expect(Number(r.baseActual)).toBe(40700);
    expect(Number(r.fxDelta)).toBe(3700);
    expect(r.fxKind).toBe('LOSS');
  });

  // ---- Which of the company's own accounts a transfer left --------------------

  it('records which account a transfer left and reads it back', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    const r = await asA(() => paySvc().record(docId, { actualRate: '1', transferFrom: 'RESERVE', file: evidence() }));
    expect(r.transferFrom).toBe('RESERVE');
    const pay = await orm.em.fork().findOneOrFail(Payment, { document: docId }, FILTER_OFF);
    expect(pay.transferFrom).toBe('RESERVE');
  });

  it('refuses a hand-recorded transfer that does not say which account it left', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    await expect(
      asA(() => paySvc().record(docId, { actualRate: '1', file: evidence() })),
    ).rejects.toThrow(/must say which account it left/i);
    // Refused before anything was written: the document is still owed.
    expect(await orm.em.fork().count(Payment, { document: docId }, FILTER_OFF)).toBe(0);
  });

  it('does not ask a cash payment which account it left, and stores none', async () => {
    // Cash left no bank account. Storing whatever the form happened to carry would leave a column
    // the next reader cannot tell a real answer from.
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    const r = await asA(() => paySvc().record(docId, { actualRate: '1', method: 'CASH', file: evidence() }));
    expect(r.transferFrom).toBeUndefined();
    const pay = await orm.em.fork().findOneOrFail(Payment, { document: docId }, FILTER_OFF);
    expect(pay.transferFrom ?? null).toBeNull();
  });

  it('refuses an account kind outside the pair, by name', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    await expect(
      asA(() => paySvc().record(docId, { actualRate: '1', transferFrom: 'PETTY_CASH' as never, file: evidence() })),
    ).rejects.toThrow(/PETTY_CASH/);
    expect(await orm.em.fork().count(Payment, { document: docId }, FILTER_OFF)).toBe(0);
  });

  it('carries each queued document\'s locked rate, as stamped', async () => {
    // So the record form can offer the rate the document already holds instead of asking finance to
    // retype it. Reported as stamped, never recomputed (invariant 6).
    const handoff = new PaymentHandoffService(orm.em, new CompanyScopeService(orm.em));
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '1000', rate: '26.5', base: '26500', gl: 'GLR' });
    const rows = await asA(() => handoff.readyToPay());
    // Compared against what the document STORES, not against the literal above: `exchange_rate` is
    // NUMERIC(_, 8), so the stamped value reads back with its scale. Asserting the stored string is
    // what makes this a test that the queue reports the rate rather than reproducing it.
    const doc = await orm.em.fork().findOneOrFail(Document, { id: docId }, FILTER_OFF);
    expect(rows.find((p) => p.documentId === docId)?.lockedRate).toBe(doc.exchangeRate);
    expect(Number(doc.exchangeRate)).toBe(26.5);
  });

  // ---- Payment slips (evidence) ---------------------------------------------

  const slipSvc = (storage = stubStorage()) => ({
    svc: new PaymentAttachmentService(orm.em, new CompanyScopeService(orm.em), storage as never),
    storage,
  });
  const file = (over: Partial<{ originalname: string; size: number }> = {}) =>
    ({
      ...fakeUpload(over.originalname ?? 'slip.png', 'image/png'),
      size: over.size ?? 2048,
    }) as never;

  async function paidDoc(): Promise<string> {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    await asA(() => paySvc().record(docId, { actualRate: '1', transferFrom: 'PRIMARY', file: evidence() }));
    return docId;
  }

  it('attaches several slips to a payment and writes no budget_txn', async () => {
    const docId = await paidDoc();
    const { svc } = slipSvc();
    await asA(() => svc.upload(docId, file({ originalname: 'a.png' })));
    await asA(() => svc.upload(docId, file({ originalname: 'b.pdf' })));

    const listed = await asA(() => svc.list(docId));
    // 'slip.png' first: the evidence the record itself required. Uploading more is still allowed —
    // the rule is that a hand-recorded payment has at least one, not exactly one.
    expect(listed.map((s) => s.fileName)).toEqual(['slip.png', 'a.png', 'b.pdf']);
    // Evidence settles nothing — the budget was settled when the document completed.
    const txns = await orm.em.fork().find(BudgetTxn, { document: docId }, FILTER_OFF);
    expect(txns).toHaveLength(0);
  });

  it('copies company from the payment rather than trusting the caller', async () => {
    const docId = await paidDoc();
    const { svc } = slipSvc();
    await asA(() => svc.upload(docId, file()));
    const payment = await orm.em.fork().findOneOrFail(Payment, { document: docId }, FILTER_OFF);
    const row = await orm.em.fork().findOneOrFail(PaymentAttachment, { payment: payment.id }, { ...FILTER_OFF, populate: ['company'] });
    expect(row.company.id).toBe(ids.coA);
  });

  it('never returns the storage key, only a presigned URL', async () => {
    const docId = await paidDoc();
    const { svc, storage } = slipSvc();
    await asA(() => svc.upload(docId, file()));
    const [listed] = await asA(() => svc.list(docId));
    expect(listed).not.toHaveProperty('filePath');
    const { url } = await asA(() => svc.downloadUrl(docId, listed.id));
    expect(url).toBe('https://signed.example/x');
    expect(storage.presignDownload).toHaveBeenCalled();
  });

  it('refuses a document in another company', async () => {
    const docId = await paidDoc();
    const { svc } = slipSvc();
    // Same document id, but acting in company B — must be not-found, never a cross-company write.
    await expect(
      RequestContext.run({ userId: ids.user, companyId: ids.coB, departmentId: ids.deptB, grants: [] }, () =>
        svc.upload(docId, file()),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('accepts a slip for a document that has no payment yet', async () => {
    // This used to be refused, and refusing it is what made a mid-approval slip impossible: a
    // workflow step can demand evidence before the money is recorded, and the evidence has to be
    // attachable at that moment or the demand can never be met.
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    const { svc } = slipSvc();
    await asA(() => svc.upload(docId, file({ originalname: 'early.png' })));

    const listed = await asA(() => svc.list(docId));
    expect(listed.map((s) => s.fileName)).toEqual(['early.png']);
    const row = await orm.em.fork().findOneOrFail(PaymentAttachment, { document: docId }, FILTER_OFF);
    expect(row.payment).toBeFalsy();
  });

  it('lets the payment adopt a slip that predates it, without duplicating it', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    const { svc } = slipSvc();
    await asA(() => svc.upload(docId, file({ originalname: 'early.png' })));

    await asA(() => paySvc().record(docId, { actualRate: '1', transferFrom: 'PRIMARY', file: evidence() }));

    const rows = await orm.em.fork().find(PaymentAttachment, { document: docId }, FILTER_OFF);
    // The early slip plus the one the record supplied — two rows, not three: the early one was
    // adopted, not copied.
    expect(rows).toHaveLength(2);
    const payment = await orm.em.fork().findOneOrFail(Payment, { document: docId }, FILTER_OFF);
    expect(rows.every((r) => r.payment?.id === payment.id)).toBe(true);
  });

  it('deletes a slip that never had a payment', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    const { svc, storage } = slipSvc();
    await asA(() => svc.upload(docId, file({ originalname: 'early.png' })));
    const [listed] = await asA(() => svc.list(docId));

    await asA(() => svc.remove(docId, listed.id));
    expect(await asA(() => svc.list(docId))).toHaveLength(0);
    expect(storage.deleteObject).toHaveBeenCalled();
  });

  it('reports a document evidenced before payment as UPLOADED', async () => {
    // The documents-list column asks whether the transfer is evidenced. Requiring a payment as well
    // would report PENDING for exactly the documents this feature exists to serve.
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    const { svc } = slipSvc();
    await asA(() => svc.upload(docId, file()));

    const handoff = new PaymentHandoffService(orm.em, new CompanyScopeService(orm.em));
    const status = await asA(() => handoff.slipStatus([docId]));
    expect(status[docId]).toBe('UPLOADED');
  });

  it('refuses an oversized file and writes no row', async () => {
    const docId = await paidDoc();
    const { svc, storage } = slipSvc();
    const tooBig = file({ size: 11 * 1024 * 1024 }); // cap is 10 MB
    await expect(asA(() => svc.upload(docId, tooBig))).rejects.toThrow();
    expect(storage.putObject).not.toHaveBeenCalled();
    // The record's own evidence stays; the refused upload added nothing.
    const rows = await asA(() => svc.list(docId));
    expect(rows.map((r) => r.fileName)).toEqual(['slip.png']);
  });

  it('deletes the row and its object together', async () => {
    const docId = await paidDoc();
    const { svc, storage } = slipSvc();
    await asA(() => svc.upload(docId, file()));
    // The second one — the first is the evidence the record required.
    const listed = (await asA(() => svc.list(docId)))[1];

    await asA(() => svc.remove(docId, listed.id));

    expect(await asA(() => svc.list(docId))).toHaveLength(1);
    // Bytes must go too: the reason to delete is that the file should not be readable.
    // Keyed by DOCUMENT, not by payment: a slip uploaded to satisfy an approval step has no payment
    // to be keyed by, and one key rule for both kinds beats a fallback nobody would test.
    expect(storage.deleteObject).toHaveBeenCalledWith(`payments/${docId}/slip.png`);
  });

  // ---- The slip states which account paid, and the payment adopts it ----------
  //
  // This is the real order of events in the business: the money goes out, finance attaches the
  // transfer slip at the approval step that demands one, and states there which of the company's
  // accounts it left. The payment is recorded afterwards. Asking again at record time would ask the
  // same person the same question about a transfer they can no longer see.

  it('stores what the slip stated, and refuses a value outside the pair', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    const { svc } = slipSvc();
    await asA(() => svc.upload(docId, file({ originalname: 'a.png' }), 'PRIMARY'));
    const [listed] = await asA(() => svc.list(docId));
    expect(listed.transferFrom).toBe('PRIMARY');

    await expect(
      asA(() => svc.upload(docId, file({ originalname: 'b.png' }), 'PETTY_CASH' as never)),
    ).rejects.toThrow(/PETTY_CASH/);
  });

  it('adopts what the transfer slip already said, without asking again', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    const { svc } = slipSvc();
    await asA(() => svc.upload(docId, file({ originalname: 'transfer.png' }), 'RESERVE'));

    // No file and no transferFrom on the record: both are already on the document.
    const r = await asA(() => paySvc().record(docId, { actualRate: '1' }));
    expect(r.transferFrom).toBe('RESERVE');
    const pay = await orm.em.fork().findOneOrFail(Payment, { document: docId }, FILTER_OFF);
    expect(pay.transferFrom).toBe('RESERVE');
  });

  it('lets the record override what the slip said', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    const { svc } = slipSvc();
    await asA(() => svc.upload(docId, file({ originalname: 'transfer.png' }), 'PRIMARY'));

    const r = await asA(() => paySvc().record(docId, { actualRate: '1', transferFrom: 'RESERVE' }));
    expect(r.transferFrom).toBe('RESERVE');
  });

  it('takes the newest slip when a later one corrects an earlier one', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    const { svc } = slipSvc();
    await asA(() => svc.upload(docId, file({ originalname: 'first.png' }), 'PRIMARY'));
    await asA(() => svc.upload(docId, file({ originalname: 'second.png' }), 'RESERVE'));

    const r = await asA(() => paySvc().record(docId, { actualRate: '1' }));
    expect(r.transferFrom).toBe('RESERVE');
  });

  it('carries the slip statement on the ready-to-pay row', async () => {
    // What lets the record form arrive with the question answered instead of asking it twice.
    const handoff = new PaymentHandoffService(orm.em, new CompanyScopeService(orm.em));
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    const { svc } = slipSvc();
    await asA(() => svc.upload(docId, file({ originalname: 'transfer.png' }), 'RESERVE'));

    const rows = await asA(() => handoff.readyToPay());
    expect(rows.find((p) => p.documentId === docId)?.statedTransferFrom).toBe('RESERVE');
  });

  it('adopts the rate the slip stated, and computes FX against it', async () => {
    // The bank's rate on the day is on the slip, keyed by the person who paid. Nobody clearing the
    // queue a week later can recover it, so the record takes what the slip said.
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '1000', rate: '1', base: '100000' });
    const { svc } = slipSvc();
    await asA(() => svc.upload(docId, file({ originalname: 'transfer.png' }), 'RESERVE', '1.05'));

    const r = await asA(() => paySvc().record(docId, {}));
    // Numeric comparison: the column is NUMERIC(_, 8), so the stated rate reads back with its scale.
    expect(Number(r.actualRate)).toBe(1.05);
    expect(Number(r.baseActual)).toBe(105000);
    expect(r.fxKind).toBe('LOSS');
    const [listed] = await asA(() => svc.list(docId));
    expect(Number(listed.actualRate)).toBe(1.05);
  });

  it('lets the record override the rate the slip stated', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '1000', rate: '1', base: '100000' });
    const { svc } = slipSvc();
    await asA(() => svc.upload(docId, file({ originalname: 'transfer.png' }), 'RESERVE', '1.05'));

    const r = await asA(() => paySvc().record(docId, { actualRate: '1.10' }));
    expect(Number(r.actualRate)).toBe(1.1);
    expect(Number(r.baseActual)).toBe(110000);
  });

  it('refuses a slip whose rate is not positive, and writes no row', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    const { svc, storage } = slipSvc();
    await expect(
      asA(() => svc.upload(docId, file({ originalname: 'bad.png' }), 'PRIMARY', '0')),
    ).rejects.toThrow(/actualRate must be positive/i);
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(await asA(() => svc.list(docId))).toHaveLength(0);
  });

  it('refuses a record when neither the request nor any slip states a rate', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    const { svc } = slipSvc();
    await asA(() => svc.upload(docId, file({ originalname: 'silent.png' }), 'PRIMARY'));

    await expect(asA(() => paySvc().record(docId, {}))).rejects.toThrow(
      /actual exchange rate is required/i,
    );
  });

  it('carries the slip rate on the ready-to-pay row', async () => {
    const handoff = new PaymentHandoffService(orm.em, new CompanyScopeService(orm.em));
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    const { svc } = slipSvc();
    await asA(() => svc.upload(docId, file({ originalname: 'transfer.png' }), 'RESERVE', '1.05'));

    const row = (await asA(() => handoff.readyToPay())).find((p) => p.documentId === docId);
    expect(Number(row?.statedActualRate)).toBe(1.05);
  });

  // ---- The flow closes itself ------------------------------------------------

  it('records the payment from the slip when the document completes', async () => {
    // The whole point: finance paid, attached the slip stating the account and the rate, and the
    // document then finished its approvals. Nobody retypes any of it.
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '1000', rate: '1', base: '100000' });
    const { svc } = slipSvc();
    await asA(() => svc.upload(docId, file({ originalname: 'transfer.png' }), 'RESERVE', '1.05'));

    const recorded = await asA(() => paySvc().recordFromSlip(docId));
    expect(recorded).not.toBeNull();
    expect(recorded!.transferFrom).toBe('RESERVE');
    expect(Number(recorded!.baseActual)).toBe(105000);

    // And it has left the queue: there is nothing for anyone to record by hand.
    const handoff = new PaymentHandoffService(orm.em, new CompanyScopeService(orm.em));
    const rows = await asA(() => handoff.readyToPay());
    expect(rows.some((p) => p.documentId === docId)).toBe(false);
  });

  it('leaves a document whose slip states too little for a person to record', async () => {
    // Half an answer is not recorded on somebody's behalf. Both cases fall back to the manual
    // queue, which is exactly the behaviour that shipped before the automatic path existed.
    const handoff = new PaymentHandoffService(orm.em, new CompanyScopeService(orm.em));
    const { svc } = slipSvc();

    const noRate = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    await asA(() => svc.upload(noRate, file({ originalname: 'a.png' }), 'PRIMARY'));
    expect(await asA(() => paySvc().recordFromSlip(noRate))).toBeNull();

    const noAccount = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    await asA(() => svc.upload(noAccount, file({ originalname: 'b.png' }), undefined, '1.05'));
    expect(await asA(() => paySvc().recordFromSlip(noAccount))).toBeNull();

    const queued = (await asA(() => handoff.readyToPay())).map((p) => p.documentId);
    expect(queued).toContain(noRate);
    expect(queued).toContain(noAccount);
    expect(await orm.em.fork().count(Payment, { document: { $in: [noRate, noAccount] } }, FILTER_OFF)).toBe(0);
  });

  it('records a document only once, however often completion is signalled', async () => {
    // The event is at-least-once in practice — a retry, a resubmitted route. The second call must
    // be a no-op rather than a 'already has a recorded payment' error thrown into a listener.
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    const { svc } = slipSvc();
    await asA(() => svc.upload(docId, file({ originalname: 'transfer.png' }), 'PRIMARY', '1'));

    expect(await asA(() => paySvc().recordFromSlip(docId))).not.toBeNull();
    expect(await asA(() => paySvc().recordFromSlip(docId))).toBeNull();
    expect(await orm.em.fork().count(Payment, { document: docId }, FILTER_OFF)).toBe(1);
  });

  it('writes no budget_txn when it records itself', async () => {
    // Invariant 3/6: the budget settled to ACTUAL when the document completed. The payment record
    // is accounting, and taking the automatic path must not change that.
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '1000', rate: '1', base: '100000' });
    const { svc } = slipSvc();
    await asA(() => svc.upload(docId, file({ originalname: 'transfer.png' }), 'RESERVE', '1.05'));

    await asA(() => paySvc().recordFromSlip(docId));
    const txns = await orm.em.fork().find(BudgetTxn, { document: docId }, FILTER_OFF);
    expect(txns).toHaveLength(0);
  });

  it('still refuses a transfer nobody has said anything about', async () => {
    const docId = await completedDoc(ids.coA, ids.deptA, ids.cutType, ids.cutTmpl, { total: '100', rate: '1', base: '100' });
    const { svc } = slipSvc();
    // Evidence, but no statement — an old slip, or one attached before this was asked.
    await asA(() => svc.upload(docId, file({ originalname: 'silent.png' })));

    await expect(asA(() => paySvc().record(docId, { actualRate: '1' }))).rejects.toThrow(
      /must say which account it left/i,
    );
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[payment-handoff] no database reachable — skipping DB-backed spec');
}
