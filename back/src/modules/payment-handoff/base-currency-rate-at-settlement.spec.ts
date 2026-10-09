import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { fakeUpload } from '../../test/fake-upload';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Workflow } from '../approval/approval.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { PaymentAttachmentService } from './payment-attachment.service';
import { PaymentService } from './payment.service';
import { Payment, PaymentAttachment } from './payment.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * A document in the company's own money has no exchange rate but 1.
 *
 * The figures are the ones this rule was written from: `RECBL-HAL-2026-0021`, a LAK document worth
 * 21,000,000, whose slip said 695. The rate was consumed at settlement two days after the
 * document's own rate had been corrected back to 1, so the restatement was 14,595,000,000 and the
 * 14,574,000,000 difference went to FX loss — balanced, unremarked, 93.7% of the ledger.
 */
describe.skipIf(!hasDb)('a base-currency document has no rate but one (DB-backed)', () => {
  let orm: MikroORM;
  const ids = { company: '', dept: '', user: '', type: '', tmpl: '', wf: '' };
  let seq = 0;

  const stubStorage = () => ({
    buildKey: (id: string, name: string) => `payments/${id}/${name}`,
    putObject: vi.fn().mockResolvedValue(undefined),
    presignDownload: vi.fn().mockResolvedValue('https://signed.example/x'),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  });

  /** Restating is another capability's business; these tests only need to see it NOT called. */
  const stubRates = () => ({ restate: vi.fn().mockResolvedValue({}) });

  const paySvc = () =>
    new PaymentService(orm.em, new CompanyScopeService(orm.em), stubStorage() as never, undefined);

  const slipSvc = (rates = stubRates()) =>
    new PaymentAttachmentService(
      orm.em,
      new CompanyScopeService(orm.em),
      stubStorage() as never,
      rates as never,
    );

  const asUser = <T>(fn: () => Promise<T>) =>
    RequestContext.run(
      { userId: ids.user, companyId: ids.company, departmentId: ids.dept, grants: [] },
      fn,
    );

  /** A settled document ready to be paid: `currency` null means the base currency, as everywhere. */
  async function completedDoc(opts: { currency?: string; rate: string; base: string }): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `BCR-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.type),
      formTemplate: em.getReference(FormTemplate, ids.tmpl),
      workflow: em.getReference(Workflow, ids.wf),
      createdBy: em.getReference(AppUser, ids.user),
      currency: opts.currency ? em.getReference(Currency, opts.currency) : undefined,
      exchangeRate: opts.rate,
      totalAmount: opts.base,
      baseTotalAmount: opts.base,
      status: DocStatus.COMPLETED,
      createdAt: new Date(),
    });
    await em.flush();
    return doc.id;
  }

  /** The slip as it already stands when the payment is recorded — what September actually had. */
  async function slipStating(documentId: string, actualRate: string): Promise<void> {
    const em = orm.em.fork();
    em.create(PaymentAttachment, {
      company: em.getReference(Company, ids.company),
      document: em.getReference(Document, documentId),
      fileName: 'slip.png',
      filePath: `payments/${documentId}/slip.png`,
      fileSizeKb: 1,
      mimeType: 'image/png',
      uploadedBy: em.getReference(AppUser, ids.user),
      uploadedAt: new Date(),
      actualRate,
    });
    await em.flush();
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    // The kip has no subunit, and the rounding is part of the figures this file reproduces:
    // 105,858,940 × 22,650 / 22,000 is 108,986,590.5 exactly, and the ledger holds 108,986,591.
    const lak = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 0, isActive: true });
    em.create(Currency, { code: 'USD', name: 'Dollar', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, {
      code: 'HAL', nameTh: 'HAL', taxId: '1', branchCode: '00000', baseCurrency: lak, isActive: true,
    });
    const dept = em.create(Department, { company, deptCode: 'AC', name: 'AC', isActive: true });
    const user = em.create(AppUser, { username: 'payer', email: 'payer@x', status: 'ACTIVE' });
    const type = em.create(DocumentType, {
      company, code: 'DISB', name: 'Disb', category: DocCategory.FINANCE,
      requiresBudget: false, requiresQuota: false, postAction: 'CUT_BUDGET', isActive: true,
    });
    const tmpl = em.create(FormTemplate, { documentType: type, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    await em.flush();
    Object.assign(ids, {
      company: company.id, dept: dept.id, user: user.id, type: type.id, tmpl: tmpl.id, wf: wf.id,
    });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('refuses a slip that states a rate on a base-currency document, and stores nothing', async () => {
    const docId = await completedDoc({ currency: 'LAK', rate: '1', base: '21000000' });

    await expect(
      asUser(() => slipSvc().upload(docId, fakeUpload('slip.png', 'image/png', 1) as never, undefined, '695')),
    ).rejects.toThrow(/can only be 1/i);

    const stored = await orm.em.fork().count(PaymentAttachment, { document: docId }, FILTER_OFF);
    expect(stored).toBe(0);
  });

  it('refuses to restate a base-currency document, leaving its rate alone', async () => {
    const docId = await completedDoc({ currency: 'LAK', rate: '1', base: '21000000' });
    const rates = stubRates();

    await expect(asUser(() => slipSvc(rates).stateRate(docId, '695'))).rejects.toThrow(/LAK/);

    expect(rates.restate).not.toHaveBeenCalled();
    const doc = await orm.em.fork().findOneOrFail(Document, { id: docId }, FILTER_OFF);
    expect(Number(doc.exchangeRate)).toBe(1);
  });

  it('refuses a rate stated on the document with no currency at all — null means the base one', async () => {
    const docId = await completedDoc({ rate: '1', base: '21000000' });

    await expect(
      asUser(() => paySvc().record(docId, {
        actualRate: '695',
        transferFrom: 'RESERVE',
        file: fakeUpload('slip.png', 'image/png', 1) as never,
      } as never)),
    ).rejects.toThrow(/can only be 1/i);
  });

  // The September failure itself: nothing is stated with the record, so the slip's figure is
  // adopted — the path a check on the statement endpoints alone would have let through.
  it('refuses a stale slip rate at settlement, writing no payment', async () => {
    const docId = await completedDoc({ currency: 'LAK', rate: '1', base: '21000000' });
    await slipStating(docId, '695');

    await expect(
      asUser(() => paySvc().record(docId, { transferFrom: 'RESERVE' } as never)),
    ).rejects.toThrow(/can only be 1/i);

    const written = await orm.em.fork().count(Payment, { document: docId }, FILTER_OFF);
    expect(written).toBe(0);
  });

  it('settles a base-currency document at 1, with no FX difference', async () => {
    const docId = await completedDoc({ currency: 'LAK', rate: '1', base: '21000000' });
    await slipStating(docId, '1');

    const result = await asUser(() => paySvc().record(docId, { transferFrom: 'RESERVE' } as never));

    expect(Number(result.baseActual)).toBe(21000000);
    expect(Number(result.fxDelta)).toBe(0);
    expect(result.fxKind).toBe('NONE');
  });

  it('leaves a genuine foreign-currency payment exactly as it was', async () => {
    const docId = await completedDoc({ currency: 'USD', rate: '22000', base: '105858940' });

    const result = await asUser(() => paySvc().record(docId, {
      actualRate: '22650',
      transferFrom: 'RESERVE',
      file: fakeUpload('slip.png', 'image/png', 1) as never,
    } as never));

    expect(Number(result.baseActual)).toBe(108986591);
    expect(Number(result.fxDelta)).toBe(3127651);
    expect(result.fxKind).toBe('LOSS');
  });
});
