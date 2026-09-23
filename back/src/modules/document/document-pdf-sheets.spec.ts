import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ApproveAction, DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { materialiseRoute } from '../../test/route-fixture';
import { Currency } from '../currency/currency.entities';
import { ApprovalLog, Workflow, WorkflowStep } from '../approval/approval.entities';
import { Budget, BudgetNode } from '../budget/budget.entities';
import { Vendor, VendorBankAccount } from '../master-data/master-data.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { DocumentPdfService } from './document-pdf.service';
import {
  DocFieldValue,
  Document,
  DocumentLine,
  DocumentType,
  FormField,
  FormTemplate,
} from './document.entities';

const hasDb = await dbAvailable();

const storageStub = { getObject: async (key: string) => Buffer.from(key) } as any;

function asCompany<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId: 'u', companyId, departmentId: 'd', grants: [] }, fn);
}

/**
 * The facts the pre-printed sheets (PR / PO / RECEIPT) add to the letter's model.
 *
 * The rule these all serve is that a form is a shape to fill in: a document naming no vendor, no
 * budget, no payee and no predecessor still builds a model, with those cells null. An export that
 * threw because a cell had no source would be a document nobody could file — and every one of these
 * cells is genuinely optional in the data, so that is the common case, not the edge case.
 */
describe.skipIf(!hasDb)('DocumentPdfService — sheet facts (DB-backed)', () => {
  let orm: MikroORM;
  let service: DocumentPdfService;
  const ids = {
    company: '', dept: '', creator: '', approver: '', tmplBare: '', tmplFull: '',
    typeLetter: '', typePr: '', typePo: '', vendor: '', payee: '', budget: '',
    purposeField: '', expectedField: '',
  };
  let seq = 0;

  async function makeWorkflow(signOnPdf = true): Promise<string> {
    const em = orm.em.fork();
    const wf = em.create(Workflow, {
      company: em.getReference(Company, ids.company),
      name: `WF-SHEET-${seq++}`,
      isActive: true,
    });
    em.create(WorkflowStep, {
      workflow: wf,
      stepNo: 1,
      approverUser: em.getReference(AppUser, ids.approver),
      approveMode: 'SEQUENTIAL',
      showSignatureOnPdf: signOnPdf,
    });
    em.create(WorkflowStep, {
      workflow: wf,
      stepNo: 2,
      approverUser: em.getReference(AppUser, ids.approver),
      approveMode: 'SEQUENTIAL',
      showSignatureOnPdf: signOnPdf,
    });
    await em.persistAndFlush(wf);
    return wf.id;
  }

  /** Record an APPROVE on a step, as the approval ledger holds it. */
  async function approve(documentId: string, stepNo: number): Promise<void> {
    const em = orm.em.fork();
    em.create(ApprovalLog, {
      document: em.getReference(Document, documentId),
      stepNo,
      approver: em.getReference(AppUser, ids.approver),
      action: ApproveAction.APPROVE,
      actedAt: new Date('2026-09-02T00:00:00.000Z'),
    });
    await em.flush();
  }

  /** A document of `typeId`, with only what the caller asks for filled in. */
  async function makeDoc(opts: {
    typeId: string;
    templateId: string;
    vendor?: boolean;
    payee?: boolean;
    budget?: boolean;
    refDocumentId?: string;
    lines?: Array<{ unit?: string; glAccount?: string; budget?: boolean }>;
    /** Skip materialising the route, like a document approved before routes were recorded. */
    noRoute?: boolean;
    signOnPdf?: boolean;
  }): Promise<string> {
    const wf = await makeWorkflow(opts.signOnPdf ?? true);
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `SHEET-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, opts.typeId),
      formTemplate: em.getReference(FormTemplate, opts.templateId),
      workflow: em.getReference(Workflow, wf),
      currentStepNo: 1,
      createdBy: em.getReference(AppUser, ids.creator),
      vendor: opts.vendor ? em.getReference(Vendor, ids.vendor) : undefined,
      vendorBankAccount: opts.payee ? em.getReference(VendorBankAccount, ids.payee) : undefined,
      refDocument: opts.refDocumentId ? em.getReference(Document, opts.refDocumentId) : undefined,
      exchangeRate: '1',
      subTotal: '250',
      taxTotal: '0',
      totalAmount: '250',
      grandTotal: '250',
      status: DocStatus.COMPLETED,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    (opts.lines ?? []).forEach((l, i) =>
      em.create(DocumentLine, {
        document: doc,
        lineNo: i + 1,
        description: `Line ${i + 1}`,
        qty: '1',
        unit: l.unit,
        unitPrice: '250',
        lineAmount: '250',
        glAccount: l.glAccount,
        budget: l.budget ? em.getReference(Budget, ids.budget) : undefined,
      }),
    );
    await em.persistAndFlush(doc);
    if (!opts.noRoute) await materialiseRoute(orm, doc.id, 1);
    return doc.id;
  }

  async function setValue(documentId: string, fieldId: string, value: string): Promise<void> {
    const em = orm.em.fork();
    em.create(DocFieldValue, {
      document: em.getReference(Document, documentId),
      formField: em.getReference(FormField, fieldId),
      fieldValue: value,
    });
    await em.flush();
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    // decimal_places 0, like LAK: the sheets print amounts to the currency's own precision.
    const lak = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 0, isActive: true });
    const company = em.create(Company, {
      code: 'SH', nameTh: 'Sheet Co', taxId: '9', branchCode: '00000', baseCurrency: lak, isActive: true,
    });
    const dept = em.create(Department, { company, deptCode: 'SD', name: 'Sheet Dept', isActive: true });
    const creator = em.create(AppUser, { username: 'sheet-creator', email: 'sc@x', status: 'ACTIVE' });
    const approver = em.create(AppUser, { username: 'sheet-approver', email: 'sa@x', status: 'ACTIVE' });
    em.create(Employee, {
      company, department: dept, user: creator, empCode: 'ESC', fullName: 'Sam Sheet',
      position: 'Officer', status: 'ACTIVE',
    });

    // Types differing ONLY by print_template — the selector must not read code or category.
    const typeLetter = em.create(DocumentType, { company, code: 'SH_L', name: 'Letter type', category: DocCategory.ADMIN, isActive: true });
    const typePr = em.create(DocumentType, { company, code: 'SH_PR', name: 'PR type', category: DocCategory.ADMIN, printTemplates: 'PR', isActive: true });
    const typePo = em.create(DocumentType, { company, code: 'SH_PO', name: 'PO type', category: DocCategory.ADMIN, printTemplates: 'PO', isActive: true });

    // A bare form (no purpose, no expected date) and a full one, to prove both directions.
    const tmplBare = em.create(FormTemplate, { documentType: typeLetter, version: 1, status: 'PUBLISHED' });
    const tmplFull = em.create(FormTemplate, { documentType: typePr, version: 1, status: 'PUBLISHED' });
    const purposeField = em.create(FormField, { formTemplate: tmplFull, fieldName: 'reason', fieldLabel: 'ຈຸດປະສົງ', fieldType: 'text', sortOrder: 10 });
    const expectedField = em.create(FormField, { formTemplate: tmplFull, fieldName: 'expected_date', fieldLabel: 'ວັນທີ່ຕ້ອງການ', fieldType: 'date', sortOrder: 20 });

    const vendor = em.create(Vendor, { vendorCode: 'V-SH', name: 'V_Rich', contactName: 'Khun A', contactPhone: '02098685856', isActive: true });
    const payee = em.create(VendorBankAccount, { vendor, bankCode: 'LDB', accountNo: '0363100410002337', accountName: 'VANHVISA KAENMANY', currency: lak, isActive: true });
    const fy = em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const node = em.create(BudgetNode, { fiscalYear: fy, code: 'BA-FB04C5', name: 'ງົບການຕະຫຼາດ' });
    const budget = em.create(Budget, { fiscalYear: fy, department: dept, node, budgetName: 'ງົບປະມານ ການຕະຫຼາດ ແລະ ການຂາຍ', glAccount: '612.06', amountTotal: '1000000', status: 'ACTIVE' });

    await em.persistAndFlush([lak, company, dept, creator, approver, typeLetter, typePr, typePo, tmplBare, tmplFull, purposeField, expectedField, vendor, payee, fy, node, budget]);
    Object.assign(ids, {
      company: company.id, dept: dept.id, creator: creator.id, approver: approver.id,
      tmplBare: tmplBare.id, tmplFull: tmplFull.id, typeLetter: typeLetter.id,
      typePr: typePr.id, typePo: typePo.id, vendor: vendor.id, payee: payee.id,
      budget: budget.id, purposeField: purposeField.id, expectedField: expectedField.id,
    });
    service = new DocumentPdfService(orm.em as any, new CompanyScopeService(orm.em), storageStub);
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  it('leaves every sheet fact null for a document that carries none of them', async () => {
    const docId = await makeDoc({ typeId: ids.typeLetter, templateId: ids.tmplBare, lines: [{}] });
    const model = await asCompany(ids.company, () => service.buildModel(docId));

    expect(model.sheet).toMatchObject({
      printTemplates: ['LETTER'],
      expectedDate: null,
      purpose: null,
      vendorName: null,
      vendorContact: null,
      payee: null,
      budgetName: null,
      budgetCode: null,
      glAccount: null,
      refDocNo: null,
    });
    expect(model.lines[0].unit).toBeNull();
  });

  it('carries the type’s configured sheet, not its code', async () => {
    const docId = await makeDoc({ typeId: ids.typePr, templateId: ids.tmplFull, lines: [{}] });
    const model = await asCompany(ids.company, () => service.buildModel(docId));
    expect(model.sheet.printTemplates).toEqual(['PR']);
  });

  it('resolves vendor, payee, budget, GL and unit when the document carries them', async () => {
    const docId = await makeDoc({
      typeId: ids.typePo,
      templateId: ids.tmplFull,
      vendor: true,
      payee: true,
      lines: [{ unit: 'ຄັ້ງ', budget: true, glAccount: '612.06' }],
    });
    const model = await asCompany(ids.company, () => service.buildModel(docId));

    expect(model.sheet.vendorName).toBe('V_Rich');
    expect(model.sheet.vendorContact).toBe('02098685856');
    expect(model.sheet.payee).toEqual({
      bank: 'LDB',
      accountNo: '0363100410002337',
      accountName: 'VANHVISA KAENMANY',
    });
    expect(model.sheet.budgetName).toBe('ງົບປະມານ ການຕະຫຼາດ ແລະ ການຂາຍ');
    // The code people write on a request is the plan node's, not the appropriation row's.
    expect(model.sheet.budgetCode).toBe('BA-FB04C5');
    expect(model.sheet.glAccount).toBe('612.06');
    expect(model.lines[0].unit).toBe('ຄັ້ງ');
  });

  it('names the predecessor a receipt settles', async () => {
    const poId = await makeDoc({ typeId: ids.typePo, templateId: ids.tmplFull, lines: [{}] });
    const poNo = (await orm.em.fork().findOneOrFail(Document, { id: poId }, { filters: { company: false } })).docNo;
    const receiptId = await makeDoc({
      typeId: ids.typePo, templateId: ids.tmplFull, refDocumentId: poId, lines: [{}],
    });

    const model = await asCompany(ids.company, () => service.buildModel(receiptId));
    expect(model.sheet.refDocNo).toBe(poNo);
  });

  it('reads the purpose and expected date from the form, by field name', async () => {
    const docId = await makeDoc({ typeId: ids.typePr, templateId: ids.tmplFull, lines: [{}] });
    await setValue(docId, ids.purposeField, '<p>ຂໍເບີກງົບປະມານຮັບແຂກ</p>');
    await setValue(docId, ids.expectedField, '2026-09-04');

    const model = await asCompany(ids.company, () => service.buildModel(docId));
    // Rich-text markup is reduced to plain text; an ISO date is shown the way the rest of the
    // sheet shows dates.
    expect(model.sheet.purpose).toBe('ຂໍເບີກງົບປະມານຮັບແຂກ');
    expect(model.sheet.expectedDate).toBe('04/09/2026');
  });

  // Every form template in this company's production database names the field `Reson` — a
  // misspelling, with the label ເຫດຜົນ. The sheet printed ຈຸດປະສົງ blank for all of them, because
  // the convention list held only the correct spelling. A separate template, so the correctly
  // spelled name above stays covered.
  it("reads the purpose from a form that misspells the field `Reson`", async () => {
    const em = orm.em.fork();
    const tmpl = em.create(FormTemplate, {
      documentType: em.getReference(DocumentType, ids.typePr),
      version: 2,
      status: 'PUBLISHED',
    });
    const field = em.create(FormField, {
      formTemplate: tmpl, fieldName: 'Reson', fieldLabel: 'ເຫດຜົນ', fieldType: 'text', sortOrder: 10,
    });
    await em.persistAndFlush([tmpl, field]);

    const docId = await makeDoc({ typeId: ids.typePr, templateId: tmpl.id, lines: [{}] });
    await setValue(docId, field.id, 'ຂໍເບີກເງິນສົມທົບປະກັນສັງຄົມ');

    const model = await asCompany(ids.company, () => service.buildModel(docId));
    expect(model.sheet.purpose).toBe('ຂໍເບີກເງິນສົມທົບປະກັນສັງຄົມ');
  });

  it('signs from the approval log when the document recorded no route', async () => {
    // Documents approved before routes were recorded have no `document_approval_step` rows, so the
    // sheet printed with no signature line at all — for a document that WAS approved, by people
    // whose names sit in the append-only log. The fallback reads that log instead.
    const docId = await makeDoc({ typeId: ids.typePr, templateId: ids.tmplFull, lines: [{}], noRoute: true });
    await approve(docId, 1);
    await approve(docId, 2);

    const model = await asCompany(ids.company, () => service.buildModel(docId));
    expect(model.signatureBlocks.map((b) => b.stepNo)).toEqual([1, 2]);
    expect(model.signatureBlocks[0].approverName).toBeTruthy();
    // Nobody has uploaded a signature, so the block prints a name and a rule to sign on.
    expect(model.signatureBlocks[0].signatureImage).toBeNull();
  });

  it('keeps printing no signatures when the route says so', async () => {
    // A recorded route with every step flagged off is a configuration decision, not missing data:
    // the fallback must not override it.
    const docId = await makeDoc({ typeId: ids.typePr, templateId: ids.tmplFull, lines: [{}], signOnPdf: false });
    await approve(docId, 1);

    const model = await asCompany(ids.company, () => service.buildModel(docId));
    expect(model.signatureBlocks).toEqual([]);
  });

  it('carries the currency’s decimal places for the amount columns', async () => {
    const docId = await makeDoc({ typeId: ids.typePr, templateId: ids.tmplFull, lines: [{}] });
    const model = await asCompany(ids.company, () => service.buildModel(docId));
    expect(model.sheet.decimalPlaces).toBe(0);
  });
});
