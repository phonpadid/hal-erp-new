import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ApproveAction, DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { signAllUsers } from '../../test/signature-fixture';
import { WorkingTimeService } from '../multi-company/working-time.service';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Currency } from '../currency/currency.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { AppUser, Role, UserCompanyRole } from '../rbac/rbac.entities';
import { ApprovalRoutingService } from './approval-routing.service';
import { ApproverResolverService } from './approver-resolver.service';
import { DocumentRouteService } from './document-route.service';
import { SlaService } from './sla.service';
import { WorkflowStepResolver } from './workflow-step.resolver';
import {
  ApprovalLog,
  DocumentApprovalStep,
  DocumentApprovalStepActor,
  Workflow,
  WorkflowStep,
} from './approval.entities';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The route a document runs is written down at submit and never re-derived.
 *
 * Before this, a document remembered one integer and every other fact about its chain was read
 * live from `workflow_step` on each advance — so editing configuration changed documents already
 * routing, a step could not be timed from when it opened, and a PARALLEL_ALL step's required
 * approvals moved with role membership.
 */
describe.skipIf(!hasDb)('the recorded route (DB-backed)', () => {
  let orm: MikroORM;
  let routing: ApprovalRoutingService;
  let route: DocumentRouteService;
  let sla: SlaService;
  let seq = 0;

  const ids = {
    company: '', dept: '', dt: '', tmpl: '', role: '',
    creator: '', a1: '', a2: '', a3: '',
  };

  const asUser = <T>(userId: string, fn: () => Promise<T>) =>
    RequestContext.run({ userId, companyId: ids.company, departmentId: ids.dept, grants: [] }, fn);

  async function workflow(steps: Array<Partial<WorkflowStep> & { stepNo: number }>): Promise<string> {
    const em = orm.em.fork();
    const wf = em.create(Workflow, { company: em.getReference(Company, ids.company), name: `WF-${seq++}`, isActive: true });
    for (const s of steps) {
      em.create(WorkflowStep, {
        workflow: wf,
        stepNo: s.stepNo,
        stepName: s.stepName,
        approverUser: s.approverUser,
        approverRole: s.approverRole,
        amountMin: s.amountMin,
        amountMax: s.amountMax,
        approveMode: s.approveMode ?? 'SEQUENTIAL',
        slaHours: s.slaHours,
        showSignatureOnPdf: s.showSignatureOnPdf ?? true,
      });
    }
    await em.flush();
    return wf.id;
  }

  async function submitted(workflowId: string, base = '10', submittedAt = new Date()): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `R-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.dt),
      formTemplate: em.getReference(FormTemplate, ids.tmpl),
      workflow: em.getReference(Workflow, workflowId),
      currentStepNo: 0,
      createdBy: em.getReference(AppUser, ids.creator),
      exchangeRate: '1',
      totalAmount: base,
      baseTotalAmount: base,
      status: DocStatus.SUBMITTED,
      submittedAt,
      createdAt: new Date(),
    });
    await em.flush();
    return doc.id;
  }

  const routeRows = (documentId: string) =>
    orm.em.fork().find(
      DocumentApprovalStep,
      { document: documentId, supersededAt: null },
      { ...FILTER_OFF, orderBy: { stepNo: 'ASC' } },
    );

  const reload = (id: string) => orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const dept = em.create(Department, { company, deptCode: 'D', name: 'D', isActive: true });
    const role = em.create(Role, { company, code: 'APPROVER', name: 'Approver', isActive: true });
    const mk = (n: string) => em.create(AppUser, { username: n, email: `${n}@x`, status: 'ACTIVE' });
    const creator = mk('r-creator');
    const a1 = mk('r-a1');
    const a2 = mk('r-a2');
    const a3 = mk('r-a3');
    for (const u of [a1, a2]) em.create(UserCompanyRole, { user: u, company, department: dept, role, isDefault: false });
    const dt = em.create(DocumentType, { company, code: 'RMEMO', name: 'Memo', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, isActive: true });
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    await em.flush();
    Object.assign(ids, {
      company: company.id, dept: dept.id, dt: dt.id, tmpl: tmpl.id, role: role.id,
      creator: creator.id, a1: a1.id, a2: a2.id, a3: a3.id,
    });

    const em2 = orm.em.fork();
    const resolver = new ApproverResolverService(em2);
    route = new DocumentRouteService(em2, new WorkflowStepResolver(em2), resolver);
    // Post-actions are another capability's business; these documents are plain memos, so a stub
    // that approves everything and posts nothing keeps the test about routing.
    const postAction = {
      assertApprovable: async () => undefined,
      run: async () => ({ paymentReady: false, stockTxnIds: [] as string[] }),
    } as never;
    // Releasing holds belongs to document-engine and these memos hold nothing, but RETURN and
    // REJECT both call through it — a null stub turns "the document went back to DRAFT" into a
    // TypeError, which is why the return path went untested here.
    const documentSubmit = { releaseDocumentHolds: async () => undefined, markPlanRejected: async () => undefined } as never;
    routing = new ApprovalRoutingService(em2, resolver, postAction, documentSubmit, route);
    sla = new SlaService(em2, new WorkingTimeService(new CompanyScopeService(em2)), resolver, route);
    // Submitting and approving need a signature on file; not this spec's subject, so everyone gets one.
    await signAllUsers(orm.em);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  // ---- 6.1 the route is written ---------------------------------------------

  it('writes one row per applicable step, copying what routing needs', async () => {
    const wfId = await workflow([
      { stepNo: 1, stepName: 'Head', approverUser: orm.em.getReference(AppUser, ids.a1), slaHours: 24 },
      { stepNo: 2, stepName: 'Director', approverUser: orm.em.getReference(AppUser, ids.a2), approveMode: 'PARALLEL_ANY' },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);

    const rows = await routeRows(docId);
    expect(rows.map((r) => r.stepNo)).toEqual([1, 2]);
    expect(rows[0].stepName).toBe('Head');
    expect(rows[0].slaHours).toBe(24);
    expect(rows[0].approverUser?.id).toBe(ids.a1);
    expect(rows[1].approveMode).toBe('PARALLEL_ANY');
    expect(rows[0].sourceWorkflowStep).toBeTruthy();
  });

  it('leaves out a step the amount band excludes', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1) },
      { stepNo: 2, approverUser: orm.em.getReference(AppUser, ids.a2), amountMin: '500000' },
    ]);
    const docId = await submitted(wfId, '400000');
    await routing.start(docId);
    expect((await routeRows(docId)).map((r) => r.stepNo)).toEqual([1]);
  });

  // ---- 6.2 configuration can no longer reach a routing document -------------

  it('ignores an edit to the configured step it came from', async () => {
    const wfId = await workflow([
      { stepNo: 1, stepName: 'Original', approverUser: orm.em.getReference(AppUser, ids.a1), slaHours: 24 },
      { stepNo: 2, approverUser: orm.em.getReference(AppUser, ids.a2) },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);

    const em = orm.em.fork();
    const configured = await em.findOneOrFail(WorkflowStep, { workflow: wfId, stepNo: 1 }, FILTER_OFF);
    configured.stepName = 'Renamed';
    configured.slaHours = 999;
    configured.approverUser = em.getReference(AppUser, ids.a3);
    await em.flush();

    const rows = await routeRows(docId);
    expect(rows[0].stepName).toBe('Original');
    expect(rows[0].slaHours).toBe(24);
    expect(rows[0].approverUser?.id).toBe(ids.a1);
  });

  it('survives the configured step being deleted, dropping only the trace', async () => {
    const wfId = await workflow([
      { stepNo: 1, stepName: 'Doomed', approverUser: orm.em.getReference(AppUser, ids.a1) },
      { stepNo: 2, approverUser: orm.em.getReference(AppUser, ids.a2) },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);

    const em = orm.em.fork();
    const configured = await em.findOneOrFail(WorkflowStep, { workflow: wfId, stepNo: 1 }, FILTER_OFF);
    await em.remove(configured).flush();

    const rows = await routeRows(docId);
    expect(rows[0].stepName).toBe('Doomed');
    expect(rows[0].sourceWorkflowStep ?? null).toBeNull();
    // and the document still routes on it
    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));
    expect((await reload(docId)).currentStepNo).toBe(2);
  });

  // ---- 6.3 the clock, which is the defect this change exists to stop --------

  it('does not leave a later step overdue on arrival after a slow earlier step', async () => {
    // Both steps allow 1 working hour. The first approver takes days.
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), slaHours: 1 },
      { stepNo: 2, approverUser: orm.em.getReference(AppUser, ids.a2), slaHours: 1 },
    ]);
    const long_ago = new Date(Date.UTC(2025, 0, 6, 3, 0, 0)); // a Monday, far in the past
    const docId = await submitted(wfId, '10', long_ago);
    await routing.start(docId);

    // Step 1 is overdue, as it should be.
    expect((await sla.currentStepSla(docId))?.overdue).toBe(true);

    // The slow approver eventually acts, and step 2 opens now.
    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));
    expect((await reload(docId)).currentStepNo).toBe(2);

    // Measured from submit, step 2 would be days overdue on arrival and the sweep would act on it
    // before its approver had seen it. Measured from its own start it has an hour.
    const status = await sla.currentStepSla(docId);
    expect(status?.overdue).toBe(false);
    expect(await sla.escalateOverdue(docId)).toBeNull();
  });

  it('stamps completed_at and started_at when routing advances', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1) },
      { stepNo: 2, approverUser: orm.em.getReference(AppUser, ids.a2) },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));

    const rows = await routeRows(docId);
    expect(rows[0].completedAt).toBeInstanceOf(Date);
    expect(rows[0].status).toBe('DONE');
    expect(rows[1].startedAt).toBeInstanceOf(Date);
    expect(rows[1].completedAt ?? null).toBeNull();
  });

  // ---- 6.5 the participant set is fixed while a step is open ----------------

  it('does not add a new role holder to a PARALLEL_ALL step already open', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverRole: orm.em.getReference(Role, ids.role), approveMode: 'PARALLEL_ALL' },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId); // recorded actors: a1, a2

    // a3 joins the role after the step opened.
    const em = orm.em.fork();
    em.create(UserCompanyRole, {
      user: em.getReference(AppUser, ids.a3),
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      role: em.getReference(Role, ids.role),
      isDefault: false,
    });
    await em.flush();

    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));
    await asUser(ids.a2, () => routing.act(docId, { action: ApproveAction.APPROVE }));

    // The two recorded actors are enough: a3 was not part of this step.
    expect((await reload(docId)).status).toBe(DocStatus.COMPLETED);

    const emc = orm.em.fork();
    const rows = await emc.find(DocumentApprovalStep, { document: docId }, FILTER_OFF);
    const actors = await emc.find(DocumentApprovalStepActor, { step: rows[0].id }, { ...FILTER_OFF, populate: ['user'] });
    expect(new Set(actors.map((a) => a.user.id))).toEqual(new Set([ids.a1, ids.a2]));
  });

  // ---- 6.6 a resubmission gets a fresh route, the old one is kept -----------

  it('supersedes the previous route on resubmission and picks up a new step', async () => {
    const wfId = await workflow([{ stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1) }]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    expect((await routeRows(docId)).map((r) => r.stepNo)).toEqual([1]);

    // Returned to DRAFT, a step is added, and it is submitted again.
    const em = orm.em.fork();
    const doc = await em.findOneOrFail(Document, { id: docId }, FILTER_OFF);
    doc.status = DocStatus.SUBMITTED;
    doc.currentStepNo = 0;
    em.create(WorkflowStep, {
      workflow: em.getReference(Workflow, wfId),
      stepNo: 2,
      approverUser: em.getReference(AppUser, ids.a2),
      approveMode: 'SEQUENTIAL',
      showSignatureOnPdf: true,
    });
    await em.flush();

    await routing.start(docId);
    expect((await routeRows(docId)).map((r) => r.stepNo)).toEqual([1, 2]);

    // The first attempt's rows are kept, marked superseded.
    const all = await orm.em.fork().find(DocumentApprovalStep, { document: docId }, FILTER_OFF);
    expect(all.filter((r) => r.supersededAt != null)).toHaveLength(1);
  });

  it('supersedes the previous route when the new one reuses the same step numbers', async () => {
    // The ordinary case, and the one that was broken: the workflow did not change, so every
    // replacement row collides with a predecessor on (document_id, step_no). The supersede has to
    // be in the database before the inserts arrive, or `document_approval_step_live_uniq` refuses
    // them, the routing transaction rolls back, and the document is left SUBMITTED with no route
    // and no approver — holding whatever its submit reserved.
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1) },
      { stepNo: 2, approverUser: orm.em.getReference(AppUser, ids.a2) },
    ]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    const first = await routeRows(docId);
    expect(first.map((r) => r.stepNo)).toEqual([1, 2]);

    // Returned to DRAFT by an approver, then sent again unchanged.
    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.RETURN }));
    expect((await reload(docId)).status).toBe(DocStatus.DRAFT);

    const em = orm.em.fork();
    const doc = await em.findOneOrFail(Document, { id: docId }, FILTER_OFF);
    doc.status = DocStatus.SUBMITTED;
    doc.currentStepNo = 0;
    await em.flush();

    await routing.start(docId);

    expect((await reload(docId)).status).toBe(DocStatus.IN_APPROVAL);
    const live = await routeRows(docId);
    expect(live.map((r) => r.stepNo)).toEqual([1, 2]);
    // Fresh rows, not the first attempt's.
    expect(live.some((r) => first.some((f) => f.id === r.id))).toBe(false);

    const all2 = await orm.em.fork().find(DocumentApprovalStep, { document: docId }, FILTER_OFF);
    expect(all2).toHaveLength(4);
    expect(all2.filter((r) => r.supersededAt != null)).toHaveLength(2);
  });

  it('refuses to start a route with no applicable step, loudly', async () => {
    const wfId = await workflow([
      { stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1), amountMin: '999999' },
    ]);
    const docId = await submitted(wfId, '10');
    await expect(routing.start(docId)).rejects.toThrow(/applicable/i);
    expect((await reload(docId)).status).toBe(DocStatus.SUBMITTED);
  });

  it('records the approval against the step, whatever the configuration later says', async () => {
    const wfId = await workflow([{ stepNo: 1, approverUser: orm.em.getReference(AppUser, ids.a1) }]);
    const docId = await submitted(wfId);
    await routing.start(docId);
    await asUser(ids.a1, () => routing.act(docId, { action: ApproveAction.APPROVE }));
    const logs = await orm.em.fork().find(ApprovalLog, { document: docId }, FILTER_OFF);
    expect(logs.map((l) => l.stepNo)).toEqual([1]);
  });
});
