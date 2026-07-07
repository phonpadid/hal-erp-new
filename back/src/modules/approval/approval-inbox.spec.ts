import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { seedDatabase } from '../../seed/seed-data';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { WorkingTimeService } from '../multi-company/working-time.service';
import { ApprovalInboxService } from './approval-inbox.service';
import { ApprovalRoutingService } from './approval-routing.service';
import { ApprovalSubmittedListener } from './approval-submitted.listener';
import { ApproverResolverService } from './approver-resolver.service';
import { SlaService } from './sla.service';
import { WorkflowStepResolver } from './workflow-step.resolver';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Workflow } from './approval.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('approval inbox + auto-start (DB-backed)', () => {
  let orm: MikroORM;
  let inbox: ApprovalInboxService;
  let listener: ApprovalSubmittedListener;
  const ids = { company: '', dept: '', prType: '', tmpl: '', workflow: '', requester: '', approver: '' };
  let seq = 0;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    const em = orm.em.fork();
    ids.company = (await em.findOneOrFail(Company, { code: 'DEMO' }, FILTER_OFF)).id;
    ids.dept = (await em.findOneOrFail(Department, { company: ids.company, deptCode: 'PROC' }, FILTER_OFF)).id;
    ids.prType = (await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF)).id;
    const mapping = await em.findOneOrFail(DeptDocType, { department: ids.dept, documentType: ids.prType }, { populate: ['formTemplate', 'workflow'], ...FILTER_OFF });
    ids.tmpl = mapping.formTemplate.id;
    ids.workflow = mapping.workflow.id;
    ids.requester = (await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF)).id;
    ids.approver = (await em.findOneOrFail(AppUser, { username: 'approver' }, FILTER_OFF)).id;

    const resolver = new ApproverResolverService(orm.em);
    const stepResolver = new WorkflowStepResolver(orm.em);
    const scope = new CompanyScopeService(orm.em);
    const sla = new SlaService(orm.em, new WorkingTimeService(scope), resolver, stepResolver);
    // start() only needs em + resolver + steps; postAction/documentSubmit are for the act path.
    const routing = new ApprovalRoutingService(orm.em, resolver, null as any, null as any, stepResolver);
    listener = new ApprovalSubmittedListener(routing);
    inbox = new ApprovalInboxService(orm.em, resolver, sla);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  async function makeDoc(status: DocStatus): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `PR-${++seq}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.prType),
      formTemplate: em.getReference(FormTemplate, ids.tmpl),
      workflow: em.getReference(Workflow, ids.workflow),
      createdBy: em.getReference(AppUser, ids.requester),
      status,
      currentStepNo: 0,
      baseTotalAmount: '100.00',
      submittedAt: new Date(),
      createdAt: new Date(),
    });
    await em.flush();
    return doc.id;
  }

  const as = <T>(userId: string, fn: () => Promise<T>) =>
    RequestContext.run({ userId, companyId: ids.company, departmentId: ids.dept, grants: [] }, fn);

  it('auto-starts routing on submit (SUBMITTED → IN_APPROVAL at step 1)', async () => {
    const id = await makeDoc(DocStatus.SUBMITTED);
    await listener.onSubmitted({ documentId: id });
    const doc = await orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);
    expect(doc.status).toBe(DocStatus.IN_APPROVAL);
    expect(doc.currentStepNo).toBe(1);
  });

  it('lists the document for an eligible approver, not for its creator', async () => {
    const id = await makeDoc(DocStatus.SUBMITTED);
    await listener.onSubmitted({ documentId: id });

    const forApprover = await as(ids.approver, () => inbox.pending());
    expect(forApprover.items.map((d) => d.id)).toContain(id);
    expect(forApprover.items.find((d) => d.id === id)!.requesterName).toBe('requester');

    const forCreator = await as(ids.requester, () => inbox.pending());
    expect(forCreator.items.map((d) => d.id)).not.toContain(id);
  });

  it('excludes documents that are not IN_APPROVAL', async () => {
    const draftId = await makeDoc(DocStatus.SUBMITTED); // left SUBMITTED (no auto-start call)
    const forApprover = await as(ids.approver, () => inbox.pending());
    expect(forApprover.items.map((d) => d.id)).not.toContain(draftId);
  });

  it('swallows when there is nothing to start (stays put, no throw)', async () => {
    const id = await makeDoc(DocStatus.DRAFT);
    await expect(listener.onSubmitted({ documentId: id })).resolves.toBeUndefined();
    const doc = await orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);
    expect(doc.status).toBe(DocStatus.DRAFT);
  });
});
