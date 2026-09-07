import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import { PDFDocument } from 'pdf-lib';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { materialiseRoute } from '../../test/route-fixture';
import { Currency } from '../currency/currency.entities';
import { Workflow, WorkflowStep } from '../approval/approval.entities';
import { PaymentAttachment } from '../payment-handoff/payment.entities';
import { PaymentPermissions } from '../payment-handoff/permissions';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { DocumentPdfService } from './document-pdf.service';
import {
  Document,
  DocumentAttachment,
  DocumentType,
  FormTemplate,
} from './document.entities';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/** A 1x1 PNG — the smallest thing that actually embeds, standing in for a transfer slip. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Storage that hands back whatever was stored under a key, and 404s for anything else. */
const objects = new Map<string, Buffer>();
const storageStub = {
  getObject: async (key: string) => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error(`no object at ${key}`);
    return bytes;
  },
} as any;

async function pageCount(bytes: Buffer): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

/**
 * Printing a finished purchase: the documents of the reference chain, and the evidence attached
 * along the way, in one file — with the two lines that decide what a caller may see (company scope
 * and `PAYMENT_VIEW`) drawn where they are drawn everywhere else.
 */
describe.skipIf(!hasDb)('Document export — chain and evidence (DB-backed)', () => {
  let orm: MikroORM;
  let service: DocumentPdfService;
  const ids = { companyA: '', companyB: '', deptA: '', deptB: '', user: '', typeA: '', typeB: '', tmplA: '', tmplB: '' };
  let seq = 0;

  async function makeWorkflow(companyId: string): Promise<string> {
    const em = orm.em.fork();
    const wf = em.create(Workflow, { company: em.getReference(Company, companyId), name: `WF-X-${seq++}`, isActive: true });
    em.create(WorkflowStep, {
      workflow: wf, stepNo: 1, approverUser: em.getReference(AppUser, ids.user),
      approveMode: 'SEQUENTIAL', showSignatureOnPdf: true,
    });
    await em.persistAndFlush(wf);
    return wf.id;
  }

  async function makeDoc(opts: { company?: 'A' | 'B'; refDocumentId?: string; docNo?: string }): Promise<string> {
    const inB = opts.company === 'B';
    const companyId = inB ? ids.companyB : ids.companyA;
    const wf = await makeWorkflow(companyId);
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: opts.docNo ?? `X-${seq++}`,
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, inB ? ids.deptB : ids.deptA),
      documentType: em.getReference(DocumentType, inB ? ids.typeB : ids.typeA),
      formTemplate: em.getReference(FormTemplate, inB ? ids.tmplB : ids.tmplA),
      workflow: em.getReference(Workflow, wf),
      currentStepNo: 1,
      createdBy: em.getReference(AppUser, ids.user),
      refDocument: opts.refDocumentId ? em.getReference(Document, opts.refDocumentId) : undefined,
      exchangeRate: '1',
      grandTotal: '100',
      status: DocStatus.COMPLETED,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    await em.persistAndFlush(doc);
    await materialiseRoute(orm, doc.id, 1);
    return doc.id;
  }

  async function attach(documentId: string, fileName: string, bytes: Buffer): Promise<void> {
    const key = `docs/${documentId}/${fileName}`;
    objects.set(key, bytes);
    const em = orm.em.fork();
    em.create(DocumentAttachment, {
      document: em.getReference(Document, documentId),
      fileName, filePath: key, fileSizeKb: 1, mimeType: 'image/png',
      uploadedBy: em.getReference(AppUser, ids.user), uploadedAt: new Date(),
    });
    await em.flush();
  }

  async function attachSlip(documentId: string, fileName: string): Promise<void> {
    const key = `slips/${documentId}/${fileName}`;
    objects.set(key, PNG_1X1);
    const em = orm.em.fork();
    em.create(PaymentAttachment, {
      company: em.getReference(Company, ids.companyA),
      document: em.getReference(Document, documentId),
      fileName, filePath: key, fileSizeKb: 1, mimeType: 'image/png',
      uploadedBy: em.getReference(AppUser, ids.user), uploadedAt: new Date(),
    });
    await em.flush();
  }

  /** Run as a reader of company A holding exactly `grants`. */
  function asReader<T>(grants: string[], fn: () => Promise<T>, companyId = ids.companyA): Promise<T> {
    return RequestContext.run(
      { userId: ids.user, companyId, departmentId: ids.deptA, grants: grants.map((code) => ({ code }) as any) },
      fn,
    );
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const lak = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 0, isActive: true });
    const companyA = em.create(Company, { code: 'XA', nameTh: 'Company A', taxId: '1', branchCode: '00000', baseCurrency: lak, isActive: true });
    const companyB = em.create(Company, { code: 'XB', nameTh: 'Company B', taxId: '2', branchCode: '00000', baseCurrency: lak, isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'XDA', name: 'Dept A', isActive: true });
    const deptB = em.create(Department, { company: companyB, deptCode: 'XDB', name: 'Dept B', isActive: true });
    const user = em.create(AppUser, { username: 'export-user', email: 'eu@x', status: 'ACTIVE' });
    const typeA = em.create(DocumentType, { company: companyA, code: 'XPR', name: 'PR', category: DocCategory.ADMIN, printTemplates: 'PR', isActive: true });
    const typeB = em.create(DocumentType, { company: companyB, code: 'XPR', name: 'PR', category: DocCategory.ADMIN, printTemplates: 'PR', isActive: true });
    const tmplA = em.create(FormTemplate, { documentType: typeA, version: 1, status: 'PUBLISHED' });
    const tmplB = em.create(FormTemplate, { documentType: typeB, version: 1, status: 'PUBLISHED' });
    await em.persistAndFlush([lak, companyA, companyB, deptA, deptB, user, typeA, typeB, tmplA, tmplB]);
    Object.assign(ids, {
      companyA: companyA.id, companyB: companyB.id, deptA: deptA.id, deptB: deptB.id,
      user: user.id, typeA: typeA.id, typeB: typeB.id, tmplA: tmplA.id, tmplB: tmplB.id,
    });
    service = new DocumentPdfService(orm.em as any, new CompanyScopeService(orm.em), storageStub);
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  it('prints a purchase as one set, predecessor first', async () => {
    const pr = await makeDoc({ docNo: 'PR-1' });
    const po = await makeDoc({ docNo: 'PO-1', refDocumentId: pr });
    const receipt = await makeDoc({ docNo: 'RC-1', refDocumentId: po });

    const chain = await asReader([], () => service.chainFor(receipt, 'CHAIN'));
    expect(chain).toEqual([pr, po, receipt]);

    const { bytes, docNo } = await asReader([], () => service.renderExport(receipt, 'CHAIN'));
    expect(docNo).toBe('RC-1');
    expect(await pageCount(bytes)).toBe(3); // one sheet each, no evidence attached
  });

  it('prints only the requested document when no parts are named', async () => {
    const pr = await makeDoc({});
    const po = await makeDoc({ refDocumentId: pr });
    const { bytes } = await asReader([], () => service.renderExport(po));
    expect(await pageCount(bytes)).toBe(1);
  });

  it('prints what exists when the chain is missing its middle document', async () => {
    const pr = await makeDoc({ docNo: 'PR-2' });
    const receipt = await makeDoc({ docNo: 'RC-2', refDocumentId: pr });
    const chain = await asReader([], () => service.chainFor(receipt, 'CHAIN'));
    expect(chain).toEqual([pr, receipt]);
  });

  it('leaves out a predecessor in another company', async () => {
    const foreign = await makeDoc({ company: 'B', docNo: 'PR-B' });
    const mine = await makeDoc({ docNo: 'RC-3', refDocumentId: foreign });

    const chain = await asReader([], () => service.chainFor(mine, 'CHAIN'));
    expect(chain).toEqual([mine]);

    // And the file holds one sheet: the other company's document contributes no page. (Asserted
    // on pages, not on the bytes — a sheet's text lives in a compressed stream, so scanning the
    // raw file for a document number would pass whether or not the page was there.)
    const { bytes } = await asReader([], () => service.renderExport(mine, 'CHAIN'));
    expect(await pageCount(bytes)).toBe(1);
  });

  it('stops at a predecessor this reader may not see', async () => {
    const hidden = await makeDoc({ docNo: 'PR-H' });
    const older = await makeDoc({ docNo: 'PR-OLD' });
    // A chain of three where the middle one is invisible to this reader.
    const middle = await makeDoc({ docNo: 'PO-H', refDocumentId: hidden });
    const mine = await makeDoc({ docNo: 'RC-H', refDocumentId: middle });
    const canRead = async (id: string) => id !== middle;

    const chain = await asReader([], () => service.chainFor(mine, 'CHAIN', canRead));
    expect(chain).toEqual([mine]);
    expect(chain).not.toContain(hidden);
    expect(chain).not.toContain(older);
  });

  it('ends a chain that loops back on itself', async () => {
    const a = await makeDoc({ docNo: 'LOOP-A' });
    const b = await makeDoc({ docNo: 'LOOP-B', refDocumentId: a });
    // Close the loop by hand: config cannot produce this, a bad migration could.
    const em = orm.em.fork();
    const first = await em.findOneOrFail(Document, { id: a }, FILTER_OFF);
    first.refDocument = em.getReference(Document, b);
    await em.flush();

    const chain = await asReader([], () => service.chainFor(b, 'CHAIN'));
    expect(chain).toEqual([a, b]);
  });

  it('prints a document’s attachments behind its own sheet', async () => {
    const doc = await makeDoc({ docNo: 'ATT-1' });
    await attach(doc, 'ສະລິບໂອນ.png', PNG_1X1);
    const { bytes } = await asReader([], () => service.renderExport(doc));
    // Sheet + the image, captioned in place. No index page ahead of it.
    expect(await pageCount(bytes)).toBe(2);
  });

  it('keeps each document’s evidence behind that document in a set', async () => {
    const pr = await makeDoc({ docNo: 'PR-3' });
    const receipt = await makeDoc({ docNo: 'RC-4', refDocumentId: pr });
    await attach(pr, 'pr-quote.png', PNG_1X1);
    await attach(receipt, 'rc-slip.png', PNG_1X1);

    const { bytes } = await asReader([], () => service.renderExport(receipt, 'CHAIN'));
    // 2 sheets + one image page each: the evidence follows its own document rather than being
    // pooled at the end, and one image does not fill a page on its own.
    expect(await pageCount(bytes)).toBe(4);
  });

  it('appends payment slips for a caller who may read them', async () => {
    const doc = await makeDoc({ docNo: 'SLIP-1' });
    await attachSlip(doc, 'bank-slip.png');
    const { bytes } = await asReader([PaymentPermissions.PAYMENT_VIEW], () => service.renderExport(doc));
    expect(await pageCount(bytes)).toBe(2); // sheet + slip
  });

  it('omits payment slips — and their names — for a caller who may not', async () => {
    const doc = await makeDoc({ docNo: 'SLIP-2' });
    await attachSlip(doc, 'bank-slip-secret.png');
    const { bytes } = await asReader([], () => service.renderExport(doc));
    expect(await pageCount(bytes)).toBe(1); // the sheet alone: no separator, no slip page
  });

  it('stands in for an attachment storage cannot hand over', async () => {
    const doc = await makeDoc({ docNo: 'MISS-1' });
    const em = orm.em.fork();
    em.create(DocumentAttachment, {
      document: em.getReference(Document, doc),
      fileName: 'gone.png', filePath: 'docs/gone/never-stored.png', fileSizeKb: 1, mimeType: 'image/png',
      uploadedBy: em.getReference(AppUser, ids.user), uploadedAt: new Date(),
    });
    await em.flush();

    const { bytes } = await asReader([], () => service.renderExport(doc));
    // The export still succeeds: sheet + a page standing in for the missing file.
    expect(await pageCount(bytes)).toBe(2);
  });
});
