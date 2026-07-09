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
import { Document, DocumentType, FormTemplate } from './document.entities';

const hasDb = await dbAvailable();

// Storage stub — getObject echoes the requested key so a test can prove WHICH signature
// file was fetched (the stamped one, never a later replacement).
const storageStub = {
  getObject: async (key: string) => Buffer.from(key),
} as any;

function asCompany<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId: 'u', companyId, departmentId: 'd', grants: [] }, fn);
}

describe.skipIf(!hasDb)('DocumentPdfService (DB-backed)', () => {
  let orm: MikroORM;
  let service: DocumentPdfService;
  const ids = { companyA: '', companyB: '', deptA: '', deptB: '', creator: '', a1: '', a2: '', s1: '', s2: '', dtId: '', tmplId: '' };
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

  async function makeDoc(companyId: string, deptId: string, workflowId: string, status: DocStatus): Promise<string> {
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
      exchangeRate: '1',
      totalAmount: '100',
      baseTotalAmount: '100',
      grandTotal: '100',
      status,
      createdAt: new Date(),
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

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const companyA = em.create(Company, { code: 'A', nameTh: 'Company A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const companyB = em.create(Company, { code: 'B', nameTh: 'Company B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'Dept A', isActive: true });
    const deptB = em.create(Department, { company: companyB, deptCode: 'DB', name: 'Dept B', isActive: true });
    const creator = em.create(AppUser, { username: 'creator-pdf', email: 'creator-pdf@x', status: 'ACTIVE' });
    const a1 = em.create(AppUser, { username: 'approver1-pdf', email: 'a1-pdf@x', status: 'ACTIVE' });
    const a2 = em.create(AppUser, { username: 'approver2-pdf', email: 'a2-pdf@x', status: 'ACTIVE' });
    em.create(Employee, { company: companyA, department: deptA, user: a1, empCode: 'E1', fullName: 'Alice Approver', status: 'ACTIVE' });
    const s1 = em.create(UserSignature, { user: a1, filePath: 'signatures/a1/first.png', mimeType: 'image/png', uploadedAt: new Date() });
    const s2 = em.create(UserSignature, { user: a1, filePath: 'signatures/a1/second.png', mimeType: 'image/png', uploadedAt: new Date() });
    const dt = em.create(DocumentType, { code: 'PDFT', name: 'PDF Type', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, isActive: true });
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    await em.persistAndFlush([thb, companyA, companyB, deptA, deptB, creator, a1, a2, s1, s2, dt, tmpl]);
    Object.assign(ids, {
      companyA: companyA.id, companyB: companyB.id, deptA: deptA.id, deptB: deptB.id,
      creator: creator.id, a1: a1.id, a2: a2.id, s1: s1.id, s2: s2.id, dtId: dt.id, tmplId: tmpl.id,
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
});
