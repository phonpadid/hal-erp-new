import { NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ApproveAction, DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { materialiseRoute } from '../../test/route-fixture';
import { Currency } from '../currency/currency.entities';
import { ApprovalLog, DocumentApprovalStep, Workflow, WorkflowStep } from '../approval/approval.entities';
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
    // A second form carrying a subject beside the reason, and a third whose subject is only captioned.
    subjTmpl: '', subjField: '', resonField: '', captTmpl: '', titleField: '', headingField: '',
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

  async function makeDoc(companyId: string, deptId: string, workflowId: string, status: DocStatus, relatedEmployeeId?: string, templateId = ids.tmplId): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `PDF-${seq++}`,
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, deptId),
      documentType: em.getReference(DocumentType, ids.dtId),
      formTemplate: em.getReference(FormTemplate, templateId),
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
    // The PDF's signature blocks come from the route the document recorded, not from the workflow
    // as it stands now — that is what keeps an issued sheet stable. These documents are built
    // without passing through submit, so give them the route a submit would have written.
    await materialiseRoute(orm, doc.id, 1);
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
    em.create(Employee, { company: companyA, department: deptA, user: a1, empCode: 'E1', fullName: 'Alice Approver', position: 'Head of Dept', status: 'ACTIVE' });
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
    // The subject sorted FIRST, before the reason: the name decides where each prints, not the order.
    const subjTmpl = em.create(FormTemplate, { documentType: dt, version: 2, status: 'PUBLISHED' });
    const subjField = em.create(FormField, { formTemplate: subjTmpl, fieldName: 'Subject', fieldLabel: 'ເລື່ອງ', fieldType: 'text', sortOrder: 1 });
    const resonField = em.create(FormField, { formTemplate: subjTmpl, fieldName: 'Reson', fieldLabel: 'ເຫດຜົນ', fieldType: 'text', sortOrder: 2 });
    // No field NAMED subject: `title` is the subject only by its caption; `heading` is neither.
    const captTmpl = em.create(FormTemplate, { documentType: dt, version: 3, status: 'PUBLISHED' });
    const titleField = em.create(FormField, { formTemplate: captTmpl, fieldName: 'title', fieldLabel: 'ເລື່ອງ:', fieldType: 'text', sortOrder: 1 });
    const headingField = em.create(FormField, { formTemplate: captTmpl, fieldName: 'heading', fieldLabel: 'ຫົວຂໍ້', fieldType: 'text', sortOrder: 2 });
    await em.persistAndFlush([thb, companyA, companyB, deptA, deptB, creator, a1, a2, relatedEmp, relatedNoPos, s1, s2, dt, tmpl, fieldA, fieldC, fieldD, subjTmpl, subjField, resonField, captTmpl, titleField, headingField]);
    Object.assign(ids, {
      companyA: companyA.id, companyB: companyB.id, deptA: deptA.id, deptB: deptB.id,
      creator: creator.id, a1: a1.id, a2: a2.id, s1: s1.id, s2: s2.id, dtId: dt.id, tmplId: tmpl.id,
      relatedEmp: relatedEmp.id, relatedNoPos: relatedNoPos.id,
      fieldA: fieldA.id, fieldC: fieldC.id, fieldD: fieldD.id,
      subjTmpl: subjTmpl.id, subjField: subjField.id, resonField: resonField.id,
      captTmpl: captTmpl.id, titleField: titleField.id, headingField: headingField.id,
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
    // Headings say in what capacity the step was signed: Alice's position in company A. approver2
    // has no employee row here, so that block keeps the step heading — its number, no name set.
    expect(model.signatureBlocks[0].heading).toBe('Head of Dept');
    expect(model.signatureBlocks[1].heading).toBe('ຂັ້ນທີ 3');
  });

  // The sheet is evidence. A sheet that changes when somebody edits a workflow is not evidence —
  // the same argument payment-batch makes for storing the exact bytes sent to a bank.
  it('produces the same sheet after the workflow it routed through is changed', async () => {
    const wf = await makeWorkflow(ids.companyA, [true, false], ids.a1); // 2 steps, 1 flagged
    const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED);
    await approve(docId, 1, ids.a1, ids.s1);

    const before = await asCompany(ids.companyA, () => service.buildModel(docId));
    expect(before.signatureBlocks.map((b) => b.stepNo)).toEqual([1]);

    // Everything the blocks are built from is edited afterwards: a step is added, an unflagged step
    // is flagged on, and the flagged one is renamed.
    const em = orm.em.fork();
    const steps = await em.find(WorkflowStep, { workflow: wf }, { orderBy: { stepNo: 'ASC' }, filters: { company: false } });
    steps[0].stepName = 'Renamed After Issue';
    steps[1].showSignatureOnPdf = true;
    em.create(WorkflowStep, {
      workflow: em.getReference(Workflow, wf),
      stepNo: 3,
      stepName: 'Added After Issue',
      approverUser: em.getReference(AppUser, ids.a1),
      approveMode: 'SEQUENTIAL',
      showSignatureOnPdf: true,
    });
    await em.flush();

    const after = await asCompany(ids.companyA, () => service.buildModel(docId));
    expect(after.signatureBlocks.map((b) => b.stepNo)).toEqual(before.signatureBlocks.map((b) => b.stepNo));
    expect(after.signatureBlocks.map((b) => b.stepName)).toEqual(before.signatureBlocks.map((b) => b.stepName));
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

  it('renders pending blocks for a document still in approval', async () => {
    const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
    const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.IN_APPROVAL); // not approved yet

    const model = await asCompany(ids.companyA, () => service.buildModel(docId));
    expect(model.signatureBlocks).toHaveLength(1);
    expect(model.signatureBlocks[0].approverName).toBeNull(); // pending
    expect(model.signatureBlocks[0].signatureImage).toBeNull();
    // A pending block is headed by what the route calls the step — here nothing, so its number.
    expect(model.signatureBlocks[0].heading).toBe('ຂັ້ນທີ 1');
    // Never submitted: no proposer block either.
    expect(model.proposerBlock).toBeNull();
  });

  it('prints the columns in step order whatever order the route rows were written in', async () => {
    // A real document printed 1, 6, 7, 2, 3, 4: MikroORM handed the route back in identity-map
    // order once other rows had been loaded in the same fork, and the query's orderBy was lost.
    const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `PDF-${seq++}`,
      company: em.getReference(Company, ids.companyA),
      department: em.getReference(Department, ids.deptA),
      documentType: em.getReference(DocumentType, ids.dtId),
      formTemplate: em.getReference(FormTemplate, ids.tmplId),
      workflow: em.getReference(Workflow, wf),
      currentStepNo: 4,
      createdBy: em.getReference(AppUser, ids.creator),
      exchangeRate: '1', totalAmount: '100', baseTotalAmount: '100', grandTotal: '100',
      status: DocStatus.IN_APPROVAL,
      createdAt: new Date('2026-07-09T00:00:00.000Z'),
    });
    // Rows written in the order the bug showed them.
    for (const stepNo of [1, 6, 7, 2, 3, 4]) {
      em.create(DocumentApprovalStep, {
        document: doc, stepNo, approverUser: em.getReference(AppUser, ids.a1), approveMode: 'SEQUENTIAL', showSignatureOnPdf: true,
      });
    }
    await em.flush();
    await approve(doc.id, 1, ids.a1, ids.s1);
    await approve(doc.id, 2, ids.a2);
    await approve(doc.id, 3, ids.a1, ids.s1);

    const model = await asCompany(ids.companyA, () => service.buildModel(doc.id));
    expect(model.signatureBlocks.map((b) => b.stepNo)).toEqual([1, 2, 3, 4, 6, 7]);
    expect(model.signatureBlocks.map((b) => b.approverName)).toEqual([
      'Alice Approver', 'approver2-pdf', 'Alice Approver', null, null, null,
    ]);
  });

  it('a pending block keeps the configured step name as its heading', async () => {
    const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
    const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.IN_APPROVAL);
    const em = orm.em.fork();
    const step = await em.findOneOrFail(DocumentApprovalStep, { document: docId, stepNo: 1 }, { filters: { company: false } });
    step.stepName = 'ຜູ້ອຳນວຍການ';
    await em.flush();

    const model = await asCompany(ids.companyA, () => service.buildModel(docId));
    expect(model.signatureBlocks[0].heading).toBe('ຜູ້ອຳນວຍການ');
  });

  it('prints the proposer first, with the signature stamped at submit and never the current one', async () => {
    const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
    const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED);
    await approve(docId, 1, ids.a1, ids.s1);
    // Stamp the creator's signature the way submit does, then move their current one elsewhere.
    const em = orm.em.fork();
    const stamped = em.create(UserSignature, { user: em.getReference(AppUser, ids.creator), filePath: 'signatures/creator/at-submit.png', mimeType: 'image/png', uploadedAt: new Date() });
    const later = em.create(UserSignature, { user: em.getReference(AppUser, ids.creator), filePath: 'signatures/creator/later.png', mimeType: 'image/png', uploadedAt: new Date() });
    await em.persistAndFlush([stamped, later]);
    const doc = await em.findOneOrFail(Document, { id: docId }, { filters: { company: false } });
    doc.submittedAt = new Date('2026-07-10T00:00:00.000Z');
    doc.submittedSignatureId = stamped.id;
    const creator = await em.findOneOrFail(AppUser, { id: ids.creator });
    creator.currentSignatureId = later.id;
    await em.flush();

    const model = await asCompany(ids.companyA, () => service.buildModel(docId));
    expect(model.proposerBlock).toMatchObject({
      stepNo: 0,
      heading: 'ຜູ້ສະເໜີ',
      approverName: 'Carol Creator',
      actedAt: new Date('2026-07-10T00:00:00.000Z'),
    });
    expect(model.proposerBlock!.signatureImage?.toString()).toBe('signatures/creator/at-submit.png');
    // The approver blocks are unchanged by the proposer's presence: still one per flagged step.
    expect(model.signatureBlocks).toHaveLength(1);
  });

  it('a submitted document with no stamp still gets a proposer block, with no image', async () => {
    const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
    const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.IN_APPROVAL);
    const em = orm.em.fork();
    const doc = await em.findOneOrFail(Document, { id: docId }, { filters: { company: false } });
    doc.submittedAt = new Date('2026-07-10T00:00:00.000Z');
    await em.flush();

    const model = await asCompany(ids.companyA, () => service.buildModel(docId));
    expect(model.proposerBlock).toMatchObject({ heading: 'ຜູ້ສະເໜີ', approverName: 'Carol Creator', signatureImage: null });
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

  /**
   * The ເລື່ອງ line. Filled from the form's subject field — by name, else by caption — and that
   * field is then not repeated in the body. A form with no such field keeps today's dotted blank.
   */
  describe('the subject line', () => {
    it('prints the subject field, and the reason stays in the body, whatever their order', async () => {
      const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
      const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED, undefined, ids.subjTmpl);
      await setValue(docId, ids.subjField, '<p>ຂໍອະນຸມັດຈັດຊື້ຄອມພິວເຕີ</p>');
      await setValue(docId, ids.resonField, 'ເຄື່ອງເກົ່າເພ');

      const model = await asCompany(ids.companyA, () => service.buildModel(docId));
      expect(model.subject).toBe('ຂໍອະນຸມັດຈັດຊື້ຄອມພິວເຕີ'); // `Subject` matched without regard to case
      // Printed once, on its own line — never again in the body.
      expect(model.fieldValues).toEqual([{ label: 'ເຫດຜົນ', value: 'ເຄື່ອງເກົ່າເພ' }]);
    });

    it('uses a field captioned ເລື່ອງ when none is named subject', async () => {
      const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
      const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED, undefined, ids.captTmpl);
      await setValue(docId, ids.titleField, 'ຂໍເບີກຄ່າເດີນທາງ');
      await setValue(docId, ids.headingField, 'ອື່ນໆ');

      const model = await asCompany(ids.companyA, () => service.buildModel(docId));
      expect(model.subject).toBe('ຂໍເບີກຄ່າເດີນທາງ');
      expect(model.fieldValues).toEqual([{ label: 'ຫົວຂໍ້', value: 'ອື່ນໆ' }]);
    });

    it('keeps the blank line for a form with no subject field', async () => {
      const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
      const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED);
      await setValue(docId, ids.fieldA, 'alpha');
      const model = await asCompany(ids.companyA, () => service.buildModel(docId));
      expect(model.subject).toBeNull();
    });

    it('keeps the blank line when the subject is empty or only markup', async () => {
      const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
      const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED, undefined, ids.subjTmpl);
      await setValue(docId, ids.subjField, '<p></p>');
      await setValue(docId, ids.resonField, 'ເຫດຜົນ ທົດສອບ');
      const model = await asCompany(ids.companyA, () => service.buildModel(docId));
      expect(model.subject).toBeNull();
      expect(model.fieldValues).toEqual([{ label: 'ເຫດຜົນ', value: 'ເຫດຜົນ ທົດສອບ' }]);
    });
  });

  /**
   * The letter as drawn. pdfkit's own methods are spied on, so the test reads what was asked of the
   * page — the subject text, and the box and alignment every signature image was placed with.
   */
  describe.skipIf(!hasPdfKit)('the letter as drawn', () => {
    // A 1×1 PNG: real image bytes, so pdfkit draws it rather than falling back to a text marker.
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );

    /** Render the letter with pdfkit's `text` and `image` recorded — the page is still drawn for real. */
    async function drawn(storage: { getObject: (key: string) => Promise<Buffer> }, docId: string, companyId = ids.companyA) {
      const { default: PDFDocument } = (await import('pdfkit')) as any;
      const texts: Array<{ text: string; x: number; y: number; options: Record<string, unknown> }> = [];
      const images: Array<{ x: number; y: number; options: Record<string, unknown> }> = [];
      let page = { width: 0, left: 0, right: 0 };
      let measure: ((t: string) => number) | undefined;
      const origText = PDFDocument.prototype.text;
      const origImage = PDFDocument.prototype.image;
      PDFDocument.prototype.text = function (this: any, ...a: any[]) {
        page = { width: this.page.width, left: this.page.margins.left, right: this.page.margins.right };
        const self = this;
        measure ??= (t: string) => {
          const size = self._fontSize;
          self.fontSize(12);
          const w = self.widthOfString(t);
          self.fontSize(size);
          return w;
        };
        texts.push({ text: String(a[0]), x: a[1], y: a[2], options: a[3] ?? {} });
        return origText.apply(this, a);
      };
      PDFDocument.prototype.image = function (this: any, src: unknown, x: number, y: number, options: Record<string, unknown>) {
        images.push({ x, y, options });
        return origImage.call(this, src, x, y, options);
      };
      try {
        const svc = new DocumentPdfService(orm.em as any, new CompanyScopeService(orm.em), storage as any);
        await asCompany(companyId, () => svc.render(docId));
      } finally {
        PDFDocument.prototype.text = origText;
        PDFDocument.prototype.image = origImage;
      }
      // The name's width as the page measured it at 12pt, captured while the document was open.
      const widths = new Map(texts.map((t) => [t.text, measure ? measure(t.text) : 0]));
      return { texts, images, page, nameWidth: (t: string) => widths.get(t) ?? 0 };
    }

    const pngStorage = { getObject: async () => PNG };

    it('prints the subject on the ເລື່ອງ line and centres each signature on its column', async () => {
      const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
      const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED, undefined, ids.subjTmpl);
      await approve(docId, 1, ids.a1, ids.s1);
      await setValue(docId, ids.subjField, 'ຂໍອະນຸມັດຈັດຊື້ຄອມພິວເຕີ');

      const { texts, images } = await drawn(pngStorage, docId);
      expect(texts.map((t) => t.text)).toContain('ເລື່ອງ: ຂໍອະນຸມັດຈັດຊື້ຄອມພິວເຕີ');

      const signatures = images.filter((i) => Array.isArray(i.options?.fit) && (i.options.fit as number[])[1] === 48);
      expect(signatures.length).toBeGreaterThan(0);
      for (const sig of signatures) {
        // Centred INSIDE its box — `fit` alone anchors the scaled image top-left.
        expect(sig.options).toMatchObject({ align: 'center', valign: 'center' });
      }
    });

    it('lays the header out as the paper form: logo centred over the name at the left, number and dated place right', async () => {
      // A real company's name — wider than the logo, so centring over it is a visible offset rather
      // than the margin a short name would clamp it to.
      const longName = 'ບໍລິສັດ ຮຸ່ງອາລຸນ ຂົນສົ່ງດ່ວນ ຈຳກັດ';
      const em = orm.em.fork();
      const company = await em.findOneOrFail(Company, { id: ids.companyA }, { filters: false });
      company.nameTh = longName;
      await em.flush();
      let result: Awaited<ReturnType<typeof drawn>>;
      try {
        const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
        const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED);
        result = await drawn(pngStorage, docId);
      } finally {
        company.nameTh = 'Company A';
        await em.flush();
      }
      const { texts, images, page, nameWidth } = result;

      // The logo: the 72×72 box, centred over the printed company name — not over the page.
      const logo = images.find((i) => (i.options.fit as number[])?.[0] === 72)!;
      expect(logo).toBeDefined();
      expect(nameWidth(longName)).toBeGreaterThan(72);
      expect(logo.x + 36).toBeCloseTo(page.left + nameWidth(longName) / 2, 5);
      const contentWidth = page.width - page.left - page.right;
      expect(logo.x + 36).toBeLessThan(page.left + contentWidth / 2); // it belongs to the left block
      // Top-aligned, so it sits right under the national header rather than floating in its box.
      expect(logo.options).toMatchObject({ align: 'center', valign: 'top' });

      // The name at the left margin, below the logo, level with the number.
      const name = texts.find((t) => t.text === longName)!;
      const number = texts.find((t) => t.text.startsWith('ເລກທີ '))!;
      expect(name.x).toBe(page.left);
      expect(name.y).toBeGreaterThan(logo.y);
      expect(number.y).toBe(name.y);
      expect(number.options).toMatchObject({ align: 'right' });

      // The date names the place of issue.
      expect(texts.map((t) => t.text)).toContain('ນະຄອນຫຼວງວຽງຈັນ, ວັນທີ 09/07/2026');

      // Tight spacing, as on the paper form: the logo right under the ---000--- separator, and the
      // title right under the header band — wider gaps pushed the whole body down the page.
      const separator = texts.find((t) => t.text.includes('000'))!;
      const dateLine = texts.find((t) => t.text.startsWith('ນະຄອນຫຼວງວຽງຈັນ'))!;
      const title = texts.find((t) => t.text === 'PDF Type')!;
      expect(logo.y - separator.y).toBeLessThan(25);
      expect(title.y - dateLine.y).toBeLessThan(28);
    });

    it('prints no canned purpose after the department', async () => {
      const wf = await makeWorkflow(ids.companyA, [true], ids.a1);
      const docId = await makeDoc(ids.companyA, ids.deptA, wf, DocStatus.COMPLETED, undefined, ids.subjTmpl);
      await setValue(docId, ids.resonField, 'ເຄື່ອງເກົ່າເພ');
      const { texts } = await drawn(pngStorage, docId);

      expect(texts.some((t) => t.text.includes('ມີຈຸດປະສົງ'))).toBe(false);
      expect(texts.map((t) => t.text)).toContain('ສັງກັດຢູ່ Dept A');
      // The requester's own reason is still printed, where the form puts it.
      expect(texts.map((t) => t.text)).toContain('ເຄື່ອງເກົ່າເພ');
    });

    it('puts the name row straight under the national header when the company has no logo', async () => {
      const wf = await makeWorkflow(ids.companyB, [true], ids.a1);
      const docId = await makeDoc(ids.companyB, ids.deptB, wf, DocStatus.COMPLETED);
      const { texts, images, page } = await drawn(pngStorage, docId, ids.companyB);

      expect(images.some((i) => (i.options.fit as number[])?.[0] === 72)).toBe(false);
      const name = texts.find((t) => t.text === 'Company B')!;
      const number = texts.find((t) => t.text.startsWith('ເລກທີ '))!;
      expect(name.x).toBe(page.left);
      expect(number.y).toBe(name.y);
    });
  });
});
