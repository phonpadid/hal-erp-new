import { NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ApproveAction, DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { ApprovalLog, Workflow, WorkflowStep } from '../approval/approval.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser, Employee, UserSignature } from '../rbac/rbac.entities';
import { DocumentPdfService } from './document-pdf.service';
import { DocFieldValue, Document, DocumentType, FormField, FormTemplate } from './document.entities';

const hasDb = await dbAvailable();

// pdfkit is an optional dependency; the render smoke test skips gracefully when it is absent,
// matching the service's lazy-load contract.
const hasPdfKit = await (async () => {
  try {
    await import('pdfkit');
    return true;
  } catch {
    return false;
  }
})();

// Storage stub — getObject echoes the requested key so a test can prove WHICH object was
// fetched (the stamped signature, or the issuing company's logo).
const storageStub = {
  getObject: async (key: string) => Buffer.from(key),
} as any;

function asCompany<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId: 'u', companyId, departmentId: 'd', grants: [] }, fn);
}

describe.skipIf(!hasDb)('DocumentPdfService (DB-backed)', () => {
  let orm: MikroORM;
  let service: DocumentPdfService;
  const ids = {
    companyA: '', companyB: '', deptA: '', deptB: '', creator: '', a1: '', a2: '', s1: '', s2: '',
    dtId: '', tmplId: '', relatedEmp: '', relatedNoPos: '', fieldA: '', fieldC: '', fieldD: '',
  };
  let seq = 0;

  /** Build a workflow with the given per-step signature flags and single approverUser per step. */
  async function makeWorkflow(companyId: string, flags: boolean[], approver: string): Promise<string> {
    const em = orm.em.fork();
    const wf = em.create(Workflow, { company: em.getReference(Company, companyId), name: `WF-${seq++}`, isActive: true });
    flags.forEach((flag, i) =>
      em.create(WorkflowStep, { workflow: wf, stepNo: i + 1, approverUser: em.getReference(AppUser, approver), approveMode: 'SEQUENTIAL', showSignatureOnPdf: flag }),
    );
    await em.persistAndFlush(wf);
    return wf.id;
  }

  async function makeDoc(companyId: string, deptId: string, workflowId: string, status: DocStatus, relatedEmployeeId?: string): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `PDF-${seq++}`,
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, deptId),
      documentType: em.getReference(DocumentType, ids.dtId),
      formTemplate: em.getReference(FormTemplate, ids.tmplId),
      workflow: em.getReference(Workflow, workflowId),
      currentStepNo: 1,
      createdBy: em.getReference(AppUser, ids.creator),
      relatedEmployee: relatedEmployeeId ? em.getReference(Employee, relatedEmployeeId) : undefined,
      exchangeRate: '1',
      totalAmount: '100',
      baseTotalAmount: '100',
      grandTotal: '100',
      status,
      createdAt: new Date('2026-07-09T00:00:00.000Z'),
    });
    await em.persistAndFlush(doc);
    return doc.id;
  }

  /** Record an APPROVE on a step, optionally stamping a signature id (the snapshot). */
  async function approve(documentId: string, stepNo: number, approver: string, signatureId?: string): Promise<void> {
    const em = orm.em.fork();
    em.create(ApprovalLog, {
      document: em.getReference(Document, documentId),
      stepNo,
      approver: em.getReference(AppUser, approver),
      action: ApproveAction.APPROVE,
      signature: signatureId ? em.getReference(UserSignature, signatureId) : undefined,
      actedAt: new Date(),
    });
    await em.flush();
  }

  /** Record a field value for a document (drives the letter body). */
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
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    // Company A carries a logo (profile_image_path); Company B intentionally has none.
    const companyA = em.create(Company, { code: 'A', nameTh: 'Company A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true, profileImagePath: 'logos/a.png', address: '123 Main Rd, Vientiane', phone: '1419', email: 'info@a.la', website: 'www.a.la' });
    const companyB = em.create(Company, { code: 'B', nameTh: 'Company B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'Dept A', isActive: true });
    const deptB = em.create(Department, { company: companyB, deptCode: 'DB', name: 'Dept B', isActive: true });
    const creator = em.create(AppUser, { username: 'creator-pdf', email: 'creator-pdf@x', status: 'ACTIVE' });
    const a1 = em.create(AppUser, { username: 'approver1-pdf', email: 'a1-pdf@x', status: 'ACTIVE' });
    const a2 = em.create(AppUser, { username: 'approver2-pdf', email: 'a2-pdf@x', status: 'ACTIVE' });
    em.create(Employee, { company: companyA, department: deptA, user: a1, empCode: 'E1', fullName: 'Alice Approver', status: 'ACTIVE' });
    // The creator's employee in company A — drives the proposer line when no related employee is set.
    em.create(Employee, { company: companyA, department: deptA, user: creator, empCode: 'EC', fullName: 'Carol Creator', position: 'Manager', status: 'ACTIVE' });
    const relatedEmp = em.create(Employee, { company: companyA, department: deptA, empCode: 'ER', fullName: 'Rex Related', position: 'Officer', status: 'ACTIVE' });
    const relatedNoPos = em.create(Employee, { company: companyA, department: deptA, empCode: 'ENP', fullName: 'Nora NoPos', status: 'ACTIVE' });
    const s1 = em.create(UserSignature, { user: a1, filePath: 'signatures/a1/first.png', mimeType: 'image/png', uploadedAt: new Date() });
    const s2 = em.create(UserSignature, { user: a1, filePath: 'signatures/a1/second.png', mimeType: 'image/png', uploadedAt: new Date() });
    const dt = em.create(DocumentType, { company: companyA, code: 'PDFT', name: 'PDF Type', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, isActive: true });
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    // Fields created out of sort order to prove the body is emitted in sort_order, not insert order.
    const fieldA = em.create(FormField, { formTemplate: tmpl, fieldName: 'fa', fieldLabel: 'Field A', fieldType: 'text', sortOrder: 30 });
    em.create(FormField, { formTemplate: tmpl, fieldName: 'fb', fieldLabel: 'Field B', fieldType: 'text', sortOrder: 10 });
    const fieldC = em.create(FormField, { formTemplate: tmpl, fieldName: 'fc', fieldLabel: 'Field C', fieldType: 'text', sortOrder: 20 });
    const fieldD = em.create(FormField, { formTemplate: tmpl, fieldName: 'fd', fieldLabel: 'Field D', fieldType: 'text', sortOrder: 40 });
    await em.persistAndFlush([thb, companyA, companyB, deptA, deptB, creator, a1, a2, relatedEmp, relatedNoPos, s1, s2, dt, tmpl, fieldA, fieldC, fieldD]);
    Object.assign(ids, {
      companyA: companyA.id, companyB: companyB.id, deptA: deptA.id, deptB: deptB.id,
      creator: creator.id, a1: a1.id, a2: a2.id, s1: s1.id, s2: s2.id, dtId: dt.id, tmplId: tmpl.id,
      relatedEmp: relatedEmp.id, relatedNoPos: relatedNoPos.id,
      fieldA: fieldA.id, fieldC: fieldC.id, fieldD: fieldD.id,
    });
    service = new DocumentPdfService(orm.em as any, new CompanyScopeService(orm.em), storageStub);
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  it('builds a model for an authorized document in the active company', async () => {
    const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
    const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED);
    await approve(docId, 1, ids.a1, ids.s1);

    const model = await asCompany(ids.companyA, () => service.buildModel(docId));
    expect(model.companyName).toBe('Company A');
    expect(model.watermark).toBe(false);
    expect(model.signatureBlocks).toHaveLength(1);
    // created_at surfaces as a Date for the ວັນທີ field.
    expect(model.createdAt).toBeInstanceOf(Date);
    // The letterhead contact block flows through from the company for the PDF footer band.
    expect(model.companyContact).toEqual({
      address: '123 Main Rd, Vientiane',
      phone: '1419',
      email: 'info@a.la',
      website: 'www.a.la',
    });
  });

  it('leaves the contact block all-null when the company has no letterhead fields', async () => {
    const wf = await makeWorkflow(ids.companyB, [true], ids.a1);
    const docId = await makeDoc(ids.companyB, ids.deptB, wf, DocStatus.COMPLETED);

    const model = await asCompany(ids.companyB, () => service.buildModel(docId));
    expect(model.companyContact).toEqual({ address: null, phone: null, email: null, website: null });
  });

  it('denies a document from another company (company isolation → not found)', async () => {
    const wf = await makeWorkflow(ids.companyB, [true], ids.a1);
    const docId = await makeDoc(ids.companyB, ids.deptB, wf, DocStatus.COMPLETED);
    await expect(asCompany(ids.companyA, () => service.buildModel(docId))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('renders one signature block per flagged step (count <= steps), skipping unflagged', async () => {
    const wf = await makeWorkflow(ids.companyA, [true, false, true], ids.a1); // 3 steps, 2 flagged
    const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED);
    await approve(docId, 1, ids.a1, ids.s1);
    await approve(docId, 2, ids.a1, ids.s1); // step 2 is unflagged → no block
    await approve(docId, 3, ids.a2); // no signature on file

    const model = await asCompany(ids.companyA, () => service.buildModel(docId));
    expect(model.signatureBlocks.map((b) => b.stepNo)).toEqual([1, 3]);
    expect(model.signatureBlocks.length).toBeLessThanOrEqual(3);
    // Step 1 resolved the approver's employee full name and its stamped signature image.
    expect(model.signatureBlocks[0].approverName).toBe('Alice Approver');
    expect(model.signatureBlocks[0].signatureImage?.toString()).toBe('signatures/a1/first.png');
    // Step 3 approved without a signature → name present, image null (placeholder).
    expect(model.signatureBlocks[1].approverName).toBe('approver2-pdf');
    expect(model.signatureBlocks[1].signatureImage).toBeNull();
  });

  it('keeps the stamped signature even after the approver replaces theirs', async () => {
    const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
    const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED);
    await approve(docId, 1, ids.a1, ids.s1); // stamped with S1

    // The approver later switches their current signature to S2.
    const em = orm.em.fork();
    const user = await em.findOneOrFail(AppUser, { id: ids.a1 });
    user.currentSignatureId = ids.s2;
    await em.flush();

    const model = await asCompany(ids.companyA, () => service.buildModel(docId));
    // Still the S1 file — the snapshot is locked to the approval, not the current signature.
    expect(model.signatureBlocks[0].signatureImage?.toString()).toBe('signatures/a1/first.png');
  });

  it('marks non-completed documents with a watermark and renders pending blocks', async () => {
    const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
    const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.IN_APPROVAL); // not approved yet

    const model = await asCompany(ids.companyA, () => service.buildModel(docId));
    expect(model.watermark).toBe(true);
    expect(model.signatureBlocks).toHaveLength(1);
    expect(model.signatureBlocks[0].approverName).toBeNull(); // pending
    expect(model.signatureBlocks[0].signatureImage).toBeNull();
  });

  it('fetches the issuing company logo from its own profile image', async () => {
    const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
    const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED);

    const model = await asCompany(ids.companyA, () => service.buildModel(docId));
    // The logo comes only from the document's own company profile_image_path (no cross-company).
    expect(model.companyLogo?.toString()).toBe('logos/a.png');
  });

  it('omits the logo when the company has no profile image (still succeeds)', async () => {
    const wf = await makeWorkflow(ids.companyB, [true], ids.a1);
    const docId = await makeDoc(ids.companyB, ids.deptB, wf, DocStatus.COMPLETED);

    const model = await asCompany(ids.companyB, () => service.buildModel(docId));
    expect(model.companyName).toBe('Company B');
    expect(model.companyLogo).toBeNull();
  });

  it('resolves the proposer from the document created_by employee when no related employee', async () => {
    const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
    const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED);

    const model = await asCompany(ids.companyA, () => service.buildModel(docId));
    expect(model.proposer).toEqual({ name: 'Carol Creator', position: 'Manager', department: 'Dept A' });
  });

  it('prefers the related employee for the proposer over the creator', async () => {
    const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
    const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED, ids.relatedEmp);

    const model = await asCompany(ids.companyA, () => service.buildModel(docId));
    expect(model.proposer).toEqual({ name: 'Rex Related', position: 'Officer', department: 'Dept A' });
  });

  it('leaves position blank when the related employee has none (still succeeds)', async () => {
    const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
    const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED, ids.relatedNoPos);

    const model = await asCompany(ids.companyA, () => service.buildModel(docId));
    expect(model.proposer.name).toBe('Nora NoPos');
    expect(model.proposer.position).toBeNull();
    expect(model.proposer.department).toBe('Dept A');
  });

  it('leaves the whole proposer blank when no employee resolves', async () => {
    // Company B has no employee for the creator → the proposer line is fully blank.
    const wf = await makeWorkflow(ids.companyB, [true], ids.a1);
    const docId = await makeDoc(ids.companyB, ids.deptB, wf, DocStatus.COMPLETED);

    const model = await asCompany(ids.companyB, () => service.buildModel(docId));
    expect(model.proposer).toEqual({ name: null, position: null, department: null });
  });

  it('emits the body in form_field sort_order and omits fields without a value', async () => {
    const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
    const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED);
    await setValue(docId, ids.fieldA, 'alpha'); // sortOrder 30
    await setValue(docId, ids.fieldC, 'gamma'); // sortOrder 20
    await setValue(docId, ids.fieldD, ''); // sortOrder 40, empty → omitted
    // Field B (sortOrder 10) has no value row → omitted.

    const model = await asCompany(ids.companyA, () => service.buildModel(docId));
    expect(model.fieldValues).toEqual([
      { label: 'Field C', value: 'gamma' },
      { label: 'Field A', value: 'alpha' },
    ]);
  });

  it('strips HTML from rich-text field values, dropping markup-only values', async () => {
    const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
    const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED);
    await setValue(docId, ids.fieldC, '<p>123456</p>'); // sortOrder 20 → plain "123456"
    await setValue(docId, ids.fieldA, '<p>line one</p><p>line two &amp; more</p>'); // sortOrder 30
    await setValue(docId, ids.fieldD, '<p></p>'); // sortOrder 40, markup only → omitted

    const model = await asCompany(ids.companyA, () => service.buildModel(docId));
    expect(model.fieldValues).toEqual([
      { label: 'Field C', value: '123456' },
      { label: 'Field A', value: 'line one\nline two & more' },
    ]);
  });

  it.skipIf(!hasPdfKit)('renders non-empty PDF bytes with the Lao font registered', async () => {
    const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
    const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED);
    await approve(docId, 1, ids.a1, ids.s1);
    await setValue(docId, ids.fieldA, 'alpha');

    const bytes = await asCompany(ids.companyA, () => service.render(docId));
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-'); // a real PDF stream
  });
});
