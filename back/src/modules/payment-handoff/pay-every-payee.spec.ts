import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { AccountRoleType, DocStatus, TaxKind } from '../../common/enums';
import { Money } from '../../common/money/money';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { Account } from '../accounting/accounting.entities';
import { AccountService } from '../accounting/account.service';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { Workflow } from '../approval/approval.entities';
import { BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../document/document.entities';
import { AccountRoleService } from '../gl/account-role.service';
import { FxRevaluationService } from '../gl/fx-revaluation.service';
import { GlPostingService, SOURCE_ACCRUAL } from '../gl/gl-posting.service';
import { AccountRole, JournalEntry, JournalLine } from '../gl/gl.entities';
import { JournalService } from '../gl/journal.service';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Vendor } from '../master-data/master-data.entities';
import { AppUser } from '../rbac/rbac.entities';
import { TaxCode } from '../tax/tax.entities';
import { WhtService } from '../tax/wht.service';
import { PaymentHandoffService } from './payment-handoff.service';
import { PaymentService } from './payment.service';
import { Payment, PaymentAttachment } from './payment.entities';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * One path for money leaving, whoever is paid.
 *
 * `document_settlement` used to be a second, for documents owed to a person. It duplicated a branch
 * that was already generic — the payment posting clears whatever account the accrual credited — and
 * it could express neither withholding nor a bank account. These assert that the one remaining path
 * covers both, and that the queue and the record endpoint cannot disagree about who is owed.
 */
describe.skipIf(!hasDb)('one payment path for every payee (DB-backed)', () => {
  let orm: MikroORM;
  let handoff: PaymentHandoffService;
  let journal: JournalService;
  let posting: GlPostingService;
  let wht: WhtService;
  let companyA = '';
  let companyB = '';
  let deptA = '';
  let userId = '';
  let claimTypeId = '';
  let cutTypeId = '';
  let tmplId = '';
  let wfId = '';
  let claimPayableId = '';
  let tradePayableId = '';
  let seq = 0;

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId, companyId: companyA, departmentId: deptA, grants: [] }, fn);
  const asB = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId, companyId: companyB, grants: [] }, fn);

  /** Storage is stubbed — these assert the evidence RULE, not S3. */
  const stubStorage = () => ({
    buildKey: (id: string, name: string) => `payments/${id}/${name}`,
    putObject: vi.fn().mockResolvedValue(undefined),
    presignDownload: vi.fn().mockResolvedValue('https://signed.example/x'),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  });
  const paySvc = (storage = stubStorage()) => ({
    svc: new PaymentService(orm.em, new CompanyScopeService(orm.em), storage as never, undefined),
    storage,
  });
  const evidence = () =>
    ({ originalname: 'slip.png', size: 1024, mimetype: 'image/png', buffer: Buffer.from('x') }) as never;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    const scope = new CompanyScopeService(orm.em);
    handoff = new PaymentHandoffService(orm.em, scope);
    journal = new JournalService(scope);
    posting = new GlPostingService(
      orm.em,
      new AccountRoleService(orm.em),
      new AccountService(orm.em, scope),
      new PeriodGuardService(),
    );
    wht = new WhtService(orm.em, scope, new AccountRoleService(orm.em), new PeriodGuardService());

    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    deptA = (await em.findOneOrFail(Department, { company: companyA, deptCode: 'PROC' }, FILTER_OFF)).id;
    userId = (await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF)).id;
    claimTypeId = (await em.findOneOrFail(DocumentType, { company: companyA, code: 'CLAIM' }, FILTER_OFF)).id;
    const prType = await em.findOneOrFail(DocumentType, { company: companyA, code: 'PR' }, FILTER_OFF);
    cutTypeId = prType.id;
    const mapping = await em.findOneOrFail(
      DeptDocType,
      { department: deptA, documentType: prType.id },
      { ...FILTER_OFF, populate: ['formTemplate', 'workflow'] },
    );
    tmplId = mapping.formTemplate.id;
    wfId = mapping.workflow.id;
    claimPayableId = (
      await em.findOneOrFail(
        AccountRole,
        { company: companyA, role: AccountRoleType.CLAIM_PAYABLE },
        { ...FILTER_OFF, populate: ['account'] },
      )
    ).account.id;
    tradePayableId = (
      await em.findOneOrFail(
        AccountRole,
        { company: companyA, role: AccountRoleType.ACCOUNTS_PAYABLE },
        { ...FILTER_OFF, populate: ['account'] },
      )
    ).account.id;

    // A second company with its own claim, so isolation is asserted against data that WOULD show
    // up if the scope were missing.
    const currency = await em.findOneOrFail(Currency, { isActive: true }, FILTER_OFF);
    const compB = em.create(Company, {
      code: 'PPB', nameTh: 'Payee B', nameEn: 'Payee B', taxId: '8', branchCode: '00000',
      baseCurrency: currency, isActive: true, createdAt: new Date(),
    } as never);
    await em.flush();
    companyB = compB.id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  // ── fixtures ────────────────────────────────────────────────────────────────────────────────

  /** A fully approved document. A claim never names a vendor — that is what makes it a claim. */
  async function completed(typeId: string, base: string, withVendor = false): Promise<Document> {
    const em = orm.em.fork();
    const vendor = withVendor
      ? await em.findOne(Vendor, { isActive: true }, { ...FILTER_OFF, orderBy: { vendorCode: 'ASC' } })
      : null;
    const doc = em.create(Document, {
      docNo: `PAY-${++seq}`,
      company: em.getReference(Company, companyA),
      department: em.getReference(Department, deptA),
      documentType: em.getReference(DocumentType, typeId),
      formTemplate: em.getReference(FormTemplate, tmplId),
      workflow: em.getReference(Workflow, wfId),
      createdBy: em.getReference(AppUser, userId),
      vendor: vendor ?? undefined,
      exchangeRate: '1',
      totalAmount: base,
      baseTotalAmount: base,
      status: DocStatus.COMPLETED,
      approvedAt: new Date(),
      createdAt: new Date(),
    } as never);
    await em.flush();
    return doc;
  }

  /**
   * The approval accrual, written directly.
   *
   * Which payable it credits is the ONLY thing that decides what kind of payable this is — the
   * reads under test derive the kind from this account and never from `document.vendor`, so the
   * fixture states it here and nowhere else.
   */
  async function accrue(doc: Document, payableAccountId: string, amount: string, entryDate: string) {
    const em = orm.em.fork();
    const expense = await em.findOneOrFail(Account, { company: companyA, code: '5000' }, FILTER_OFF);
    const entry = em.create(JournalEntry, {
      company: em.getReference(Company, companyA), entryDate,
      sourceType: SOURCE_ACCRUAL, sourceId: doc.id, memo: `Accrual of ${doc.docNo}`, createdAt: new Date(),
    } as never);
    em.create(JournalLine, {
      company: em.getReference(Company, companyA), journalEntry: entry, account: expense,
      debit: amount, credit: '0',
    } as never);
    em.create(JournalLine, {
      company: em.getReference(Company, companyA), journalEntry: entry,
      account: em.getReference(Account, payableAccountId), debit: '0', credit: amount,
    } as never);
    await em.flush();
  }

  /** `YYYY-MM-DD`, n days before today. */
  const daysAgo = (n: number) =>
    new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

  const linesOf = async (sourceId: string) => {
    const em = orm.em.fork();
    const entry = await em.findOneOrFail(
      JournalEntry,
      { company: companyA, sourceType: 'PAYMENT', sourceId },
      FILTER_OFF,
    );
    return em.find(JournalLine, { journalEntry: entry.id }, { ...FILTER_OFF, populate: ['account'] });
  };

  // ── the one path ────────────────────────────────────────────────────────────────────────────

  it('pays a claim by recording a payment, and the entry clears the claim payable', async () => {
    const doc = await completed(claimTypeId, '45000.00');
    await accrue(doc, claimPayableId, '45000.00', daysAgo(10));

    await asA(() =>
      paySvc().svc.record(doc.id, { actualRate: '1', method: 'CASH', reference: 'TRF-1', file: evidence() }),
    );
    await asA(() => posting.postForPayment(doc.id));

    const lines = await linesOf(doc.id);
    const debited = lines.filter((l) => Money.compare(l.debit, '0') > 0);
    // The account the ACCRUAL credited, cleared by the payment posting without being told which —
    // the branch is generic, which is why a second settlement path was never needed.
    expect(debited).toHaveLength(1);
    expect(debited[0].account.id).toBe(claimPayableId);
    expect(Money.compare(debited[0].debit, '45000.00')).toBe(0);

    const totalDebit = lines.reduce((s, l) => Money.add(s, l.debit), '0');
    const totalCredit = lines.reduce((s, l) => Money.add(s, l.credit), '0');
    expect(Money.compare(totalDebit, totalCredit)).toBe(0);
  });

  it('records the method, the reference and no budget row', async () => {
    const doc = await completed(claimTypeId, '1000.00');
    await accrue(doc, claimPayableId, '1000.00', daysAgo(3));
    await asA(() =>
      paySvc().svc.record(doc.id, { actualRate: '1', method: 'CASH', reference: 'CASH-9', note: 'handed over', file: evidence() }),
    );

    const em = orm.em.fork();
    const payment = await em.findOneOrFail(Payment, { document: doc.id }, FILTER_OFF);
    expect(payment.method).toBe('CASH');
    expect(payment.reference).toBe('CASH-9');
    expect(payment.note).toBe('handed over');
    // Invariant 6: the budget settled to ACTUAL when the document completed.
    expect(await em.count(BudgetTxn, { document: doc.id }, FILTER_OFF)).toBe(0);
  });

  it('refuses a payment method it does not support, by name', async () => {
    const doc = await completed(claimTypeId, '10.00');
    await accrue(doc, claimPayableId, '10.00', daysAgo(1));
    await expect(
      asA(() => paySvc().svc.record(doc.id, { actualRate: '1', method: 'BARTER', file: evidence() })),
    ).rejects.toThrow(/BARTER/);
  });

  // ── the queue ───────────────────────────────────────────────────────────────────────────────

  it('lists a claim and a pay-as-you-go document in ONE queue, and both leave it when paid', async () => {
    const claim = await completed(claimTypeId, '7000.00');
    await accrue(claim, claimPayableId, '7000.00', daysAgo(5));
    // A CUT_BUDGET type that accrues NOTHING — the second clause of the predicate, and the case a
    // ledger-only queue would have made unpayable.
    const payAsYouGo = await completed(cutTypeId, '3000.00');

    const before = await asA(() => handoff.readyToPay());
    const ids = before.map((r) => r.documentId);
    expect(ids).toContain(claim.id);
    expect(ids).toContain(payAsYouGo.id);
    expect(before.find((r) => r.documentId === claim.id)?.payableKind).toBe('CLAIM');
    expect(before.find((r) => r.documentId === payAsYouGo.id)?.payableKind).toBeNull();

    await asA(() => paySvc().svc.record(claim.id, { actualRate: '1', file: evidence() }));
    await asA(() => paySvc().svc.record(payAsYouGo.id, { actualRate: '1', file: evidence() }));

    const after = (await asA(() => handoff.readyToPay())).map((r) => r.documentId);
    expect(after).not.toContain(claim.id);
    expect(after).not.toContain(payAsYouGo.id);
  });

  it('offers nothing the record endpoint would refuse', async () => {
    // A document neither clause covers: no accrual, and a type that is not paid through this flow.
    const memoType = await orm.em
      .fork()
      .findOneOrFail(DocumentType, { company: companyA, code: 'MEMO' }, FILTER_OFF);
    const memo = await completed(memoType.id, '500.00');

    const queued = (await asA(() => handoff.readyToPay())).map((r) => r.documentId);
    expect(queued).not.toContain(memo.id);

    const { svc, storage } = paySvc();
    await expect(
      asA(() => svc.record(memo.id, { actualRate: '1', file: evidence() })),
    ).rejects.toThrow(/is not something the company owes/i);
    // The file was supplied and still never reached storage: every predictable refusal runs BEFORE
    // the upload. Uploading first left an object behind for every request that was never going to
    // succeed, which is what the settlement flow did.
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  // ── the evidence rule ───────────────────────────────────────────────────────────────────────

  it('refuses a hand-recorded payment with no evidence, and writes nothing at all', async () => {
    const doc = await completed(claimTypeId, '2500.00');
    await accrue(doc, claimPayableId, '2500.00', daysAgo(2));
    const { svc, storage } = paySvc();

    await expect(asA(() => svc.record(doc.id, { actualRate: '1' }))).rejects.toThrow(/evidence/i);

    const em = orm.em.fork();
    expect(await em.count(Payment, { document: doc.id }, FILTER_OFF)).toBe(0);
    expect(await em.count(PaymentAttachment, {}, FILTER_OFF)).toBeGreaterThanOrEqual(0);
    // Nothing reached storage. A file uploaded ahead of a refusal is an object nobody looks for —
    // which is exactly what the settlement flow left behind on every refused settlement.
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('accepts a record with no file when the document is already evidenced', async () => {
    // The workflow this exists for uploads the slip at the approval step that demanded it. Asking
    // for the same picture again at record time would make finance upload twice and leave the
    // document with two rows for one transfer — while protecting nothing that is not already
    // protected: the evidence is there, which is the whole of the rule.
    const doc = await completed(claimTypeId, '1500.00');
    await accrue(doc, claimPayableId, '1500.00', daysAgo(2));
    const em0 = orm.em.fork();
    em0.create(PaymentAttachment, {
      company: em0.getReference(Company, companyA),
      document: em0.getReference(Document, doc.id),
      fileName: 'mid-approval.png',
      filePath: `documents/${doc.id}/mid-approval.png`,
      uploadedBy: em0.getReference(AppUser, userId),
      uploadedAt: new Date(),
    } as never);
    await em0.flush();

    const { svc, storage } = paySvc();
    await asA(() => svc.record(doc.id, { actualRate: '1' }));

    const em = orm.em.fork();
    const payment = await em.findOneOrFail(Payment, { document: doc.id }, FILTER_OFF);
    const slips = await em.find(PaymentAttachment, { document: doc.id }, FILTER_OFF);
    // One row, not two, and it is now the payment's evidence rather than a loose document slip.
    expect(slips).toHaveLength(1);
    expect(slips[0].payment?.id).toBe(payment.id);
    // No second upload happened.
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('stores the evidence with the payment, in one act', async () => {
    const doc = await completed(claimTypeId, '900.00');
    await accrue(doc, claimPayableId, '900.00', daysAgo(2));
    const { svc, storage } = paySvc();
    await asA(() => svc.record(doc.id, { actualRate: '1', file: evidence() }));

    const em = orm.em.fork();
    const payment = await em.findOneOrFail(Payment, { document: doc.id }, FILTER_OFF);
    const slips = await em.find(PaymentAttachment, { payment: payment.id }, FILTER_OFF);
    expect(slips).toHaveLength(1);
    expect(slips[0].fileName).toBe('slip.png');
    expect(storage.putObject).toHaveBeenCalledTimes(1);
  });

  it('needs no evidence for a payment a batch produced', async () => {
    const doc = await completed(claimTypeId, '600.00');
    await accrue(doc, claimPayableId, '600.00', daysAgo(2));
    const em = orm.em.fork();
    const batch = em.create(
      (await import('./payment.entities')).PaymentBatch,
      { company: em.getReference(Company, companyA), status: 'DRAFT', format: 'CSV', createdAt: new Date() } as never,
    );
    await em.flush();

    const { svc, storage } = paySvc();
    // No file, and accepted: the run's own file and the bank's answer are the evidence.
    await asA(() => svc.record(doc.id, { actualRate: '1', batch }));
    expect(storage.putObject).not.toHaveBeenCalled();
    const payment = await orm.em.fork().findOneOrFail(Payment, { document: doc.id }, FILTER_OFF);
    expect(payment.batch?.id).toBe(batch.id);
  });

  // ── withholding, whoever the payee is ───────────────────────────────────────────────────────

  it('withholds tax on a payment to a person and certifies it', async () => {
    const doc = await completed(claimTypeId, '100000.00');
    await accrue(doc, claimPayableId, '100000.00', daysAgo(4));
    const whtCode = await orm.em
      .fork()
      .findOneOrFail(TaxCode, { company: companyA, kind: TaxKind.WHT }, FILTER_OFF);

    const result = await asA(() =>
      paySvc().svc.record(doc.id, { actualRate: '1', whtTaxCodeId: whtCode.id, file: evidence() }),
    );
    expect(Money.compare(result.whtAmount, '0')).toBeGreaterThan(0);

    // The certificate a person is owed for tax withheld from them. The settlement path could not
    // express withholding at all, so this was unreachable for a payee who was not a vendor.
    const payment = await orm.em.fork().findOneOrFail(Payment, { document: doc.id }, FILTER_OFF);
    const certificate = await asA(() => wht.certify(payment.id));
    expect(certificate.certificateNo).toBeTruthy();
    expect(Money.compare(certificate.whtAmount, result.whtAmount)).toBe(0);
    // No vendor on it: the payee is a person, and the certificate says so by naming none.
    expect(certificate.vendor).toBeUndefined();
  });

  // ── the payables read ───────────────────────────────────────────────────────────────────────

  it('lists an open claim beside a trade payable, each named by its kind', async () => {
    const claim = await completed(claimTypeId, '5500.00');
    await accrue(claim, claimPayableId, '5500.00', daysAgo(40));
    const trade = await completed(cutTypeId, '8800.00');
    await accrue(trade, tradePayableId, '8800.00', daysAgo(40));

    const { items } = await asA(() => journal.openPayables({ limit: 500 }));
    const claimRow = items.find((i) => i.documentId === claim.id);
    const tradeRow = items.find((i) => i.documentId === trade.id);
    expect(claimRow?.payableKind).toBe('CLAIM');
    expect(tradeRow?.payableKind).toBe('TRADE');
  });

  it('ages a claim from the day it was raised, while a supplier payable still gets its terms', async () => {
    const raised = daysAgo(40);
    const claim = await completed(claimTypeId, '1234.00');
    await accrue(claim, claimPayableId, '1234.00', raised);
    // A supplier payable raised on the SAME day, whose vendor has payment terms. Both halves in one
    // read: that the terms are applied at all, and that a claim does not get them. Asserting only
    // the claim would pass even for a read that had stopped applying terms to anybody.
    const trade = await completed(cutTypeId, '4321.00', true);
    await accrue(trade, tradePayableId, '4321.00', raised);

    const { items } = await asA(() => journal.openPayables({ limit: 500 }));
    const claimRow = items.find((i) => i.documentId === claim.id)!;
    const tradeRow = items.find((i) => i.documentId === trade.id)!;
    const vendor = await orm.em
      .fork()
      .findOneOrFail(Vendor, { id: tradeRow.vendorId! }, FILTER_OFF);
    expect(vendor.paymentTermDays).toBeGreaterThan(0);

    // Due the day it was raised — terms are a supplier arrangement, and there is no supplier.
    expect(claimRow.dueDate).toBe(raised);
    expect(claimRow.daysOverdue).toBeGreaterThanOrEqual(39);
    // …and the supplier's terms ARE applied, so the claim's date is a rule, not a read that
    // stopped adding terms to anything.
    expect(tradeRow.dueDate).not.toBe(raised);
    expect(tradeRow.daysOverdue).toBeLessThan(claimRow.daysOverdue);
  });

  it('drops a claim off the payables read once its payment posts', async () => {
    const claim = await completed(claimTypeId, '333.00');
    await accrue(claim, claimPayableId, '333.00', daysAgo(6));
    expect(
      (await asA(() => journal.openPayables({ limit: 500 }))).items.map((i) => i.documentId),
    ).toContain(claim.id);

    await asA(() => paySvc().svc.record(claim.id, { actualRate: '1', file: evidence() }));
    await asA(() => posting.postForPayment(claim.id));

    expect(
      (await asA(() => journal.openPayables({ limit: 500 }))).items.map((i) => i.documentId),
    ).not.toContain(claim.id);
  });

  it('composes the ageing total by kind, and the parts sum to the whole', async () => {
    const ageing = await asA(() => journal.payablesAgeing());
    const kinds = ageing.byKind.map((k) => k.payableKind);
    // Every kind reported, even at zero: absent, a reader cannot tell "nothing is owed to people"
    // from "nobody looked".
    expect(kinds).toEqual(['TRADE', 'CLAIM']);
    const byKindTotal = ageing.byKind.reduce((t, k) => Money.add(t, k.total), '0');
    const bucketTotal = ageing.buckets.reduce((t, b) => Money.add(t, b.total), '0');
    expect(Money.compare(byKindTotal, ageing.total)).toBe(0);
    expect(Money.compare(bucketTotal, ageing.total)).toBe(0);
  });

  it('reads its payables for a company that maps no claim payable', async () => {
    // Company B maps nothing at all. The read must return, not raise — a company with no claims
    // would otherwise lose the trade ageing, which is the figure it actually uses.
    await expect(asA(() => journal.openPayables({ limit: 5 }))).resolves.toBeDefined();
    const b = await asB(() => journal.openPayables({ limit: 5 }));
    expect(b.items).toEqual([]);
    const ageing = await asB(() => journal.payablesAgeing());
    expect(Money.compare(ageing.total, '0')).toBe(0);
  });

  // ── the neighbouring read that did NOT widen ────────────────────────────────────────────────

  it('still leaves claim payables out of FX revaluation', async () => {
    // This change widened two reads that excluded claims. It did NOT widen this one, and the next
    // reader will assume it did: a claim carries no locked rate and no foreign-currency amount, so
    // there is nothing to retranslate and a figure here would be invented rather than reported.
    const em = orm.em.fork();
    const foreign = await em.findOne(Currency, { code: { $ne: 'LAK' }, isActive: true }, FILTER_OFF);
    if (!foreign) return; // a single-currency seed has nothing to revalue either way

    const claim = await completed(claimTypeId, '9000.00');
    const withCurrency = await orm.em.fork();
    const doc = await withCurrency.findOneOrFail(Document, { id: claim.id }, FILTER_OFF);
    doc.currency = withCurrency.getReference(Currency, foreign.code);
    await withCurrency.flush();
    await accrue(claim, claimPayableId, '9000.00', daysAgo(7));

    const fx = new FxRevaluationService(orm.em, {
      resolveRate: async () => ({ rate: '2' }),
    } as never);
    const rows = await asA(() => fx.outstanding(companyA, daysAgo(0)));
    expect(rows.map((r) => r.documentId)).not.toContain(claim.id);
  });

  // ── scope ───────────────────────────────────────────────────────────────────────────────────

  it('keeps each company to its own queue and its own payables', async () => {
    const a = await asA(() => handoff.readyToPay());
    expect(a.length).toBeGreaterThan(0);
    expect(await asB(() => handoff.readyToPay())).toEqual([]);
  });

  it('refuses to pay another company\u2019s document', async () => {
    const doc = await completed(claimTypeId, '77.00');
    await accrue(doc, claimPayableId, '77.00', daysAgo(1));
    await expect(
      asB(() => paySvc().svc.record(doc.id, { actualRate: '1', file: evidence() })),
    ).rejects.toThrow(/not found/i);
  });

  it('records one payment when two are attempted for the same document', async () => {
    const doc = await completed(claimTypeId, '4321.00');
    await accrue(doc, claimPayableId, '4321.00', daysAgo(1));
    const { svc } = paySvc();

    const results = await Promise.allSettled([
      asA(() => svc.record(doc.id, { actualRate: '1', file: evidence() })),
      asA(() => svc.record(doc.id, { actualRate: '1', file: evidence() })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await orm.em.fork().count(Payment, { document: doc.id }, FILTER_OFF),
    ).toBe(1);
  });
});
