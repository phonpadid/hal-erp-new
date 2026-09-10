import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ApproveAction, DocCategory, DocStatus } from '../../common/enums';
import { ErrorCode, isCoded } from '../../common/errors/error-code';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Currency } from '../currency/currency.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { PaymentAttachment } from '../payment-handoff/payment.entities';
import { PaymentAttachmentService } from '../payment-handoff/payment-attachment.service';
import { AppUser, Role, UserCompanyRole } from '../rbac/rbac.entities';
import { ApprovalRoutingService } from './approval-routing.service';
import { ApproverResolverService } from './approver-resolver.service';
import { DocumentRouteService } from './document-route.service';
import { WorkflowStepResolver } from './workflow-step.resolver';
import { ApprovalLog, DocumentApprovalStep, Workflow, WorkflowStep } from './approval.entities';
import { LockMode } from '@mikro-orm/postgresql';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * A step that demands a transfer slip cannot be approved without one.
 *
 * The workflow this exists for transfers the money mid-route: finance moves it at its step and a
 * later approver signs off on a transfer that has already happened. Nothing made the slip a
 * condition of that step, so it could be approved on an assurance and the document completed with
 * the evidence still missing.
 *
 * What is actually being tested is the ORDER of the refusal, not merely that it refuses.
 * `approval_log` is append-only, so an approval that must be refused has to be refused before the
 * row is written — there is no compensating row afterwards. Every negative case here therefore
 * asserts what did NOT happen, not just that a throw occurred.
 */
describe.skipIf(!hasDb)('a step may require a transfer slip (DB-backed)', () => {
  let orm: MikroORM;
  let routing: ApprovalRoutingService;
  let seq = 0;

  const ids = { company: '', dept: '', dt: '', tmpl: '', role: '', creator: '', a1: '', a2: '' };

  const asUser = <T>(userId: string, fn: () => Promise<T>) =>
    RequestContext.run({ userId, companyId: ids.company, departmentId: ids.dept, grants: [] }, fn);

  async function workflow(steps: Array<Partial<WorkflowStep> & { stepNo: number }>): Promise<string> {
    const em = orm.em.fork();
    const wf = em.create(Workflow, {
      company: em.getReference(Company, ids.company),
      name: `SLIP-WF-${seq++}`,
      isActive: true,
    });
    for (const s of steps) {
      em.create(WorkflowStep, {
        workflow: wf,
        stepNo: s.stepNo,
        approverUser: s.approverUser,
        approveMode: s.approveMode ?? 'SEQUENTIAL',
        showSignatureOnPdf: true,
        requiresPaymentSlip: s.requiresPaymentSlip ?? false,
      });
    }
    await em.flush();
    return wf.id;
  }

  async function submitted(workflowId: string): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `SLIP-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.dt),
      formTemplate: em.getReference(FormTemplate, ids.tmpl),
      workflow: em.getReference(Workflow, workflowId),
      currentStepNo: 0,
      createdBy: em.getReference(AppUser, ids.creator),
      exchangeRate: '1',
      totalAmount: '10',
      baseTotalAmount: '10',
      status: DocStatus.SUBMITTED,
      submittedAt: new Date(),
      createdAt: new Date(),
    });
    await em.flush();
    return doc.id;
  }

  /** A slip on a document, with no payment — the state this whole change exists to allow. */
  async function attachSlip(documentId: string): Promise<string> {
    const em = orm.em.fork();
    const slip = em.create(PaymentAttachment, {
      company: em.getReference(Company, ids.company),
      document: em.getReference(Document, documentId),
      fileName: `slip-${seq++}.jpg`,
      filePath: `slips/${documentId}/slip.jpg`,
      uploadedBy: em.getReference(AppUser, ids.a1),
      uploadedAt: new Date(),
    });
    await em.flush();
    return slip.id;
  }

  /** The real slip service, with storage stubbed — these assert the RULE, not S3. */
  const slipService = () =>
    new PaymentAttachmentService(orm.em, new CompanyScopeService(orm.em), {
      buildKey: (id: string, name: string) => `documents/${id}/${name}`,
      putObject: async () => undefined,
      presignDownload: async () => 'https://signed.example/x',
      deleteObject: async () => undefined,
    } as never);

  const reload = (id: string) => orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);
  const logs = (documentId: string) =>
    orm.em.fork().find(ApprovalLog, { document: documentId }, FILTER_OFF);
  const routeRows = (documentId: string) =>
    orm.em.fork().find(
      DocumentApprovalStep,
      { document: documentId, supersededAt: null },
      { ...FILTER_OFF, orderBy: { stepNo: 'ASC' } },
    );

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, {
      code: 'S', nameTh: 'S', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true,
    });
    const dept = em.create(Department, { company, deptCode: 'D', name: 'D', isActive: true });
    const role = em.create(Role, { company, code: 'FIN', name: 'Finance', isActive: true });
    const mk = (n: string) => em.create(AppUser, { username: n, email: `${n}@x`, status: 'ACTIVE' });
    const creator = mk('s-creator');
    const a1 = mk('s-a1');
    const a2 = mk('s-a2');
    for (const u of [a1, a2]) {
      em.create(UserCompanyRole, { user: u, company, department: dept, role, isDefault: false });
    }
    const dt = em.create(DocumentType, {
      company, code: 'SMEMO', name: 'Memo', category: DocCategory.ADMIN,
      requiresBudget: false, requiresQuota: false, isActive: true,
    });
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    await em.flush();
    Object.assign(ids, {
      company: company.id, dept: dept.id, dt: dt.id, tmpl: tmpl.id, role: role.id,
      creator: creator.id, a1: a1.id, a2: a2.id,
    });

    const em2 = orm.em.fork();
    const resolver = new ApproverResolverService(em2);
    const route = new DocumentRouteService(em2, new WorkflowStepResolver(em2), resolver);
    // These memos post nothing and hold nothing; stubs keep the test about the slip gate.
    const postAction = {
      assertApprovable: async () => undefined,
      run: async () => ({ paymentReady: false, stockTxnIds: [] as string[] }),
    } as never;
    const documentSubmit = { releaseDocumentHolds: async () => undefined, markPlanRejected: async () => undefined } as never;
    routing = new ApprovalRoutingService(em2, resolver, postAction, documentSubmit, route);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  // ---- the gate itself -------------------------------------------------------

  it('refuses the approval, and records nothing, while no slip is attached', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);

    await expect(
      asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE })),
    ).rejects.toThrow(/transfer slip/i);

    // The refusal has to come before the append-only row, not be undone after it.
    expect(await logs(docId)).toHaveLength(0);
    const doc = await reload(docId);
    expect(doc.status).toBe(DocStatus.IN_APPROVAL);
    expect(doc.currentStepNo).toBe(1);
    const rows = await routeRows(docId);
    expect(rows[0].status).not.toBe('APPROVED');
  });

  it('names itself so the approval screen can offer an upload instead of an error', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);

    const err = await asUser(ids.a1, () =>
      routing.act(docId, { action: ApproveAction.APPROVE }).then(
        () => null,
        (e: unknown) => e,
      ),
    );
    expect(isCoded(err)).toBe(true);
    expect((err as { code: string }).code).toBe(ErrorCode.PAYMENT_SLIP_REQUIRED);
  });

  it('accepts the approval once a slip is attached', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    await attachSlip(docId);

    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));
    expect((await reload(docId)).status).toBe(DocStatus.COMPLETED);
    expect(await logs(docId)).toHaveLength(1);
  });

  it('leaves a step without the requirement alone', async () => {
    const wfId = await workflow([{ stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1) }]);
    const docId = await submitted(wfId);
    await routing.start(docId);

    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));
    expect((await reload(docId)).status).toBe(DocStatus.COMPLETED);
  });

  it('does not count another document’s slip', async () => {
    // The gate asks whether THIS document is evidenced. A count that forgot its filter would pass
    // here and pass in production for every document once any one of them had a slip.
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
    ]);
    const evidenced = await submitted(wfId);
    await routing.start(evidenced);
    await attachSlip(evidenced);

    const bare = await submitted(wfId);
    await routing.start(bare);

    await expect(
      asUser(ids.a1, () => routing.act(bare, { action: ApproveAction.APPROVE })),
    ).rejects.toThrow(/transfer slip/i);
    expect(await logs(bare)).toHaveLength(0);
  });

  it('gates only the step that asks for it, not the ones after it', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
      { stepNo: 2, approverUser: orm.em.getReference(AppUser, ids.a2) },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);

    await expect(
      asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE })),
    ).rejects.toThrow(/transfer slip/i);

    await attachSlip(docId);
    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));
    expect((await reload(docId)).currentStepNo).toBe(2);

    // Step 2 asks for nothing; it must not inherit step 1's condition.
    await asUser(ids.a2, () => routing.act(docId, { action: ApproveAction.APPROVE }));
    expect((await reload(docId)).status).toBe(DocStatus.COMPLETED);
  });

  // ---- the escape hatches ----------------------------------------------------

  it('still lets the approver reject a document it cannot evidence', async () => {
    // Without this the gate would be a trap: a document nobody can produce a slip for would have no
    // way out of approval at all.
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);

    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.REJECT }));
    expect((await reload(docId)).status).toBe(DocStatus.REJECTED);
  });

  it('still lets the approver return it', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);

    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.RETURN }));
    expect((await reload(docId)).status).toBe(DocStatus.DRAFT);
  });

  // ---- the requirement travels with the route, not with configuration --------

  it('is copied onto the route at submit, so turning it on cannot re-term a document already routing', async () => {
    const wfId = await workflow([{ stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1) }]);
    const docId = await submitted(wfId);
    await routing.start(docId);

    // Configuration changes AFTER this document was submitted.
    const em = orm.em.fork();
    const step = await em.findOneOrFail(WorkflowStep, { workflow: wfId, stepNo: 1 }, FILTER_OFF);
    step.requiresPaymentSlip = true;
    await em.flush();

    // The document runs the route it recorded, exactly as it does for its approver and amount band.
    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));
    expect((await reload(docId)).status).toBe(DocStatus.COMPLETED);

    // ...and a document submitted afterwards does get the new terms.
    const later = await submitted(wfId);
    await routing.start(later);
    await expect(
      asUser(ids.a1, () => routing.act(later, { action: ApproveAction.APPROVE })),
    ).rejects.toThrow(/transfer slip/i);
  });

  // ---- concurrency -----------------------------------------------------------

  it('refuses both of two approvers racing a gated step with no slip', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), approveMode: 'PARALLEL_ANY' },
    ]);
    const em0 = orm.em.fork();
    const ws = await em0.findOneOrFail(WorkflowStep, { workflow: wfId, stepNo: 1 }, FILTER_OFF);
    ws.requiresPaymentSlip = true;
    ws.approverUser = undefined;
    ws.approverRole = em0.getReference(Role, ids.role);
    await em0.flush();

    const docId = await submitted(wfId);
    await routing.start(docId);

    const results = await Promise.allSettled([
      asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE })),
      asUser(ids.a2, () => routing.act(docId, { action: ApproveAction.APPROVE })),
    ]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    // The point of the lock: neither may leave a row behind for the other to trip over.
    expect(await logs(docId)).toHaveLength(0);
    expect((await reload(docId)).status).toBe(DocStatus.IN_APPROVAL);
  });

  it('records exactly one approval when two approvers race a gated step that IS evidenced', async () => {
    const wfId = await workflow([{ stepNo: 1, approveMode: 'PARALLEL_ANY' }]);
    const em0 = orm.em.fork();
    const ws = await em0.findOneOrFail(WorkflowStep, { workflow: wfId, stepNo: 1 }, FILTER_OFF);
    ws.requiresPaymentSlip = true;
    ws.approverRole = em0.getReference(Role, ids.role);
    await em0.flush();

    const docId = await submitted(wfId);
    await routing.start(docId);
    await attachSlip(docId);

    const results = await Promise.allSettled([
      asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE })),
      asUser(ids.a2, () => routing.act(docId, { action: ApproveAction.APPROVE })),
    ]);
    // PARALLEL_ANY completes on the first; the second finds a document no longer in approval. One
    // slip does not license two approvals.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await reload(docId)).status).toBe(DocStatus.COMPLETED);
    expect(await logs(docId)).toHaveLength(1);
  });

  // ---- the evidence outlives the approval it justified ------------------------

  it('refuses to remove the last slip once the step it satisfied has been approved', async () => {
    // The approve gate can only refuse an approval that has not happened. Without this, the evidence
    // a signature rests on could be deleted the minute after it was given, leaving an append-only
    // `approval_log` row asserting something nobody can produce.
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
      { stepNo: 2, approverUser: orm.em.getReference(AppUser, ids.a2) },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    const slipId = await attachSlip(docId);
    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));

    const svc = slipService();
    await expect(asUser(ids.a1, () => svc.remove(docId, slipId))).rejects.toThrow(/only transfer slip/i);
    expect(await orm.em.fork().count(PaymentAttachment, { document: docId }, FILTER_OFF)).toBe(1);
  });

  it('names the refusal so the screen can offer an upload instead of repeating it', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
      { stepNo: 2, approverUser: orm.em.getReference(AppUser, ids.a2) },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    const slipId = await attachSlip(docId);
    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));

    const svc = slipService();
    const err = await asUser(ids.a1, () =>
      svc.remove(docId, slipId).then(
        () => null,
        (e: unknown) => e,
      ),
    );
    expect(isCoded(err)).toBe(true);
    expect((err as { code: string }).code).toBe(ErrorCode.EVIDENCE_IS_LOAD_BEARING);
  });

  it('still allows correcting a wrong file while another slip remains', async () => {
    // Deleting one of several is how the wrong customer's slip gets taken down. Refusing that would
    // push people to leave it attached, which is the privacy problem `remove` exists to solve.
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
      { stepNo: 2, approverUser: orm.em.getReference(AppUser, ids.a2) },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    const wrong = await attachSlip(docId);
    await attachSlip(docId);
    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));

    const svc = slipService();
    await asUser(ids.a1, () => svc.remove(docId, wrong));
    expect(await orm.em.fork().count(PaymentAttachment, { document: docId }, FILTER_OFF)).toBe(1);
  });

  it('leaves a document whose steps never demanded evidence alone', async () => {
    const wfId = await workflow([{ stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1) }]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    const slipId = await attachSlip(docId);
    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));

    const svc = slipService();
    await asUser(ids.a1, () => svc.remove(docId, slipId));
    expect(await orm.em.fork().count(PaymentAttachment, { document: docId }, FILTER_OFF)).toBe(0);
  });

  it('allows removing a slip on a step that has not been approved yet', async () => {
    // Nothing rests on it yet — an upload made by mistake before the approval is just a mistake.
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    const slipId = await attachSlip(docId);

    const svc = slipService();
    await asUser(ids.a1, () => svc.remove(docId, slipId));
    expect(await orm.em.fork().count(PaymentAttachment, { document: docId }, FILTER_OFF)).toBe(0);
  });

  it('never records an approval against evidence a concurrent delete removed', async () => {
    // The delete takes the document's row lock precisely so this cannot interleave: either the
    // delete lands first and the approval is refused, or the approval commits and the delete
    // follows it. What must never happen is an approval recorded while the count was already zero.
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), requiresPaymentSlip: true },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    const slipId = await attachSlip(docId);

    // Mirrors what PaymentAttachmentService.remove does: take the document's row lock first, so the
    // two transactions serialise on the same row instead of interleaving.
    const del = orm.em.fork().transactional(async (tem) => {
      await tem.findOne(Document, { id: docId }, { ...FILTER_OFF, lockMode: LockMode.PESSIMISTIC_WRITE });
      await tem.nativeDelete(PaymentAttachment, { id: slipId }, FILTER_OFF);
    });
    const approve = asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));
    const [approval, deletion] = await Promise.allSettled([approve, del]);

    expect(deletion.status).toBe('fulfilled');
    expect(await orm.em.fork().count(PaymentAttachment, { document: docId }, FILTER_OFF)).toBe(0);

    // The property under test: an approval exists only if it committed while the slip still did.
    // Both orderings are legitimate; "approved, and the evidence was already gone" is not.
    const recorded = await logs(docId);
    expect(recorded).toHaveLength(approval.status === 'fulfilled' ? 1 : 0);
  });
});
