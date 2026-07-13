import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { ApproverResolverService } from '../approval/approver-resolver.service';
import { WorkflowStepResolver } from '../approval/workflow-step.resolver';
import { SlaService } from '../approval/sla.service';
import { Workflow, WorkflowStep } from '../approval/approval.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { WorkingTimeService } from '../multi-company/working-time.service';
import { AppUser } from '../rbac/rbac.entities';
import { Notification, NotificationTemplate } from './notification.entities';
import { NotificationScheduler } from './notification.scheduler';
import { NotificationService } from './notification.service';
import { TemplateService } from './template.service';
import { InAppTransport, type NotificationTransport } from './transports/transport';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

const boom: NotificationTransport = { channel: 'BOOM', send: async () => { throw new Error('transport down'); } };

describe.skipIf(!hasDb)('notifications (DB-backed)', () => {
  let orm: MikroORM;
  let templates: TemplateService;
  let notifications: NotificationService;
  let scheduler: NotificationScheduler;

  const ids = { companyA: '', deptA: '', creator: '', ua: '', u1: '', u2: '', dtPlain: '', tmplPlain: '' };
  let seq = 0;

  async function makeDoc(opts: { workflowId: string; status: DocStatus; submittedAt?: Date }): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `D-${seq++}`,
      company: em.getReference(Company, ids.companyA),
      department: em.getReference(Department, ids.deptA),
      documentType: em.getReference(DocumentType, ids.dtPlain),
      formTemplate: em.getReference(FormTemplate, ids.tmplPlain),
      workflow: em.getReference(Workflow, opts.workflowId),
      currentStepNo: opts.status === DocStatus.IN_APPROVAL ? 1 : 0,
      createdBy: em.getReference(AppUser, ids.creator),
      exchangeRate: '1',
      status: opts.status,
      submittedAt: opts.submittedAt,
      createdAt: new Date(),
    });
    await em.flush();
    return doc.id;
  }

  async function makeWorkflow(step?: { slaHours?: number; approverUserId?: string }): Promise<string> {
    const em = orm.em.fork();
    const wf = em.create(Workflow, { company: em.getReference(Company, ids.companyA), name: `WF-${seq++}`, isActive: true });
    if (step) {
      em.create(WorkflowStep, {
        workflow: wf,
        stepNo: 1,
        approverUser: step.approverUserId ? em.getReference(AppUser, step.approverUserId) : undefined,
        approveMode: 'SEQUENTIAL',
        slaHours: step.slaHours,
      });
    }
    await em.flush();
    return wf.id;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'DA', isActive: true });
    const creator = em.create(AppUser, { username: 'creator', email: 'creator@x', status: 'ACTIVE' });
    const ua = em.create(AppUser, { username: 'ua', email: 'ua@x', status: 'ACTIVE' });
    const u1 = em.create(AppUser, { username: 'u1', email: 'u1@x', status: 'ACTIVE' });
    const u2 = em.create(AppUser, { username: 'u2', email: 'u2@x', status: 'ACTIVE' });
    const dtPlain = em.create(DocumentType, { company: companyA, code: 'MEMO', name: 'Memo', category: DocCategory.ADMIN, isActive: true });
    const tmplPlain = em.create(FormTemplate, { documentType: dtPlain, version: 1, status: 'PUBLISHED' });
    await em.flush();
    Object.assign(ids, {
      companyA: companyA.id, deptA: deptA.id, creator: creator.id, ua: ua.id, u1: u1.id, u2: u2.id,
      dtPlain: dtPlain.id, tmplPlain: tmplPlain.id,
    });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    const scope = new CompanyScopeService(orm.em);
    templates = new TemplateService(orm.em);
    notifications = new NotificationService(orm.em, templates, [new InAppTransport(), boom]);
    const resolver = new ApproverResolverService(orm.em);
    const stepResolver = new WorkflowStepResolver(orm.em);
    scheduler = new NotificationScheduler(
      orm.em,
      new SlaService(orm.em, new WorkingTimeService(scope), resolver, stepResolver),
      resolver,
      notifications,
    );
  });

  const forUser = (userId: string) =>
    orm.em.fork().find(Notification, { user: userId }, { filters: { company: false } });

  // ---- 7.1 Rendering ---------------------------------------------------------

  it('renders {placeholders} from variables', async () => {
    const t = await templates.create({ code: 'X', channel: 'IN_APP', subjectTemplate: '{doc_no}', bodyTemplate: 'Hi {requester_name}' });
    const r = templates.render(t, { doc_no: 'PR-A-2026-0001', requester_name: 'Alice' });
    expect(r.subject).toBe('PR-A-2026-0001');
    expect(r.body).toBe('Hi Alice');
  });

  // ---- 7.2 IN_APP dispatch ---------------------------------------------------

  it('dispatches IN_APP and records SENT', async () => {
    const n = await notifications.dispatch({ userId: ids.u1, companyId: ids.companyA, channel: 'IN_APP', title: 't', message: 'm' });
    expect(n.status).toBe('SENT');
    expect(n.sentAt).toBeTruthy();
    const rows = await forUser(ids.u1);
    expect(rows.some((r) => r.id === n.id && r.status === 'SENT')).toBe(true);
  });

  // ---- 7.3 FAILED path -------------------------------------------------------

  it('records FAILED when the transport throws', async () => {
    const n = await notifications.dispatch({ userId: ids.u1, companyId: ids.companyA, channel: 'BOOM', title: 't', message: 'm' });
    expect(n.status).toBe('FAILED');
  });

  // ---- 7.4 Read tracking -----------------------------------------------------

  it('marks read and filters unread', async () => {
    const read = await notifications.dispatch({ userId: ids.u2, companyId: ids.companyA, channel: 'IN_APP', message: 'a' });
    await notifications.dispatch({ userId: ids.u2, companyId: ids.companyA, channel: 'IN_APP', message: 'b' });
    const marked = await notifications.markRead(read.id, ids.u2);
    expect(marked.isRead).toBe(true);
    expect(marked.readAt).toBeTruthy();

    const unread = await notifications.listForUser(ids.u2, { unreadOnly: true });
    expect(unread.items.every((r) => !r.isRead)).toBe(true);
    expect(unread.items.find((r) => r.id === read.id)).toBeUndefined();
  });

  // ---- 7.5 Approval pending --------------------------------------------------

  it('notifies each eligible approver of a pending document', async () => {
    const wfId = await makeWorkflow();
    const docId = await makeDoc({ workflowId: wfId, status: DocStatus.IN_APPROVAL, submittedAt: new Date() });
    await notifications.notifyApprovalPending(docId, [ids.u1, ids.u2]);
    const forDoc = await orm.em.fork().find(Notification, { document: docId }, { filters: { company: false } });
    expect(new Set(forDoc.map((n) => n.user.id))).toEqual(new Set([ids.u1, ids.u2]));
  });

  // ---- 7.6 SLA overdue scan --------------------------------------------------

  it('SLA scan notifies overdue documents only', async () => {
    // Overdue: submitted on a past Friday, 1-hour SLA.
    const overdueWf = await makeWorkflow({ slaHours: 1, approverUserId: ids.ua });
    const overdueId = await makeDoc({ workflowId: overdueWf, status: DocStatus.IN_APPROVAL, submittedAt: new Date(Date.UTC(2026, 0, 2, 12, 0, 0)) });
    // Not overdue: submitted now with a huge SLA.
    const freshWf = await makeWorkflow({ slaHours: 100000, approverUserId: ids.ua });
    const freshId = await makeDoc({ workflowId: freshWf, status: DocStatus.IN_APPROVAL, submittedAt: new Date() });

    const count = await scheduler.scanOverdue(new Date());
    expect(count).toBeGreaterThanOrEqual(1);

    const overdueNotes = await orm.em.fork().find(Notification, { document: overdueId }, { filters: { company: false } });
    const freshNotes = await orm.em.fork().find(Notification, { document: freshId }, { filters: { company: false } });
    expect(overdueNotes.length).toBeGreaterThanOrEqual(1);
    expect(freshNotes.length).toBe(0);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[notifications] no database reachable — skipping DB-backed spec');
}
