import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { materialiseRoute } from '../../test/route-fixture';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser, UserCompanyRole } from '../rbac/rbac.entities';
import {seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { WorkingTimeService } from '../multi-company/working-time.service';
import { ApprovalInboxService } from './approval-inbox.service';
import { ApprovalRoutingService } from './approval-routing.service';
import { ApprovalSubmittedListener } from './approval-submitted.listener';
import { DocumentRouteService } from './document-route.service';
import { ApproverResolverService } from './approver-resolver.service';
import { SlaService } from './sla.service';
import { WorkflowStep } from './approval.entities';
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
    ids.company = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    ids.dept = (await em.findOneOrFail(Department, { company: ids.company, deptCode: 'PROC' }, FILTER_OFF)).id;
    ids.prType = (await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF)).id;
    const mapping = await em.findOneOrFail(DeptDocType, { department: ids.dept, documentType: ids.prType }, { populate: ['formTemplate', 'workflow'], ...FILTER_OFF });
    ids.tmpl = mapping.formTemplate.id;
    ids.workflow = mapping.workflow.id;
    ids.requester = (await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF)).id;

    // Resolve the approver from the workflow the seed actually bound to PR, rather than assuming a
    // username. The seed routes PR through the 7-step "Full Approval Chain", whose step 1 targets a
    // chain role no plain 'approver' user holds — hardcoding one meant this test silently asserted
    // against an inbox that could never contain the document.
    const step1 = await em.findOneOrFail(
      WorkflowStep,
      { workflow: ids.workflow, stepNo: 1 },
      { populate: ['approverRole', 'approverUser'], ...FILTER_OFF },
    );
    const holder = step1.approverUser
      ? step1.approverUser
      : (
          await em.findOneOrFail(
            UserCompanyRole,
            { role: step1.approverRole!.id, company: ids.company },
            { populate: ['user'], ...FILTER_OFF },
          )
        ).user;
    ids.approver = holder.id;

    const resolver = new ApproverResolverService(orm.em);
    const stepResolver = new WorkflowStepResolver(orm.em);
    const scope = new CompanyScopeService(orm.em);
    const sla = new SlaService(orm.em, new WorkingTimeService(scope), resolver, stepResolver);
    // start() only needs em + resolver + steps; postAction/documentSubmit are for the act path.
    const routing = new ApprovalRoutingService(orm.em, resolver, null as any, null as any, new DocumentRouteService(orm.em, stepResolver, resolver));
    listener = new ApprovalSubmittedListener(routing);
    inbox = new ApprovalInboxService(orm.em, resolver, sla, new DocumentRouteService(orm.em, stepResolver, resolver));
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
    // A document parked straight into IN_APPROVAL never passes through start(), so give it the
    // route a real submit would have written.
    if (status === DocStatus.IN_APPROVAL) await materialiseRoute(orm, doc.id, doc.currentStepNo);
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

  it('searches the whole pending set, not just the page the caller asked for', async () => {
    // The inbox pages. An approver with more pending documents than fit on one page has no other
    // way to find one, so a search that only reached the loaded page would be worse than none.
    const ids_ = [];
    for (let i = 0; i < 3; i++) {
      const id = await makeDoc(DocStatus.SUBMITTED);
      await listener.onSubmitted({ documentId: id });
      ids_.push(id);
    }
    const target = await orm.em.fork().findOneOrFail(Document, { id: ids_[2] }, FILTER_OFF);

    // Page 1 with a window of one holds a DIFFERENT document than the one searched for.
    const firstPage = await as(ids.approver, () => inbox.pending({ page: 1, limit: 1 }));
    expect(firstPage.items[0].id).not.toBe(target.id);

    // The search still finds it, from page 1, because the server filtered before paging.
    const found = await as(ids.approver, () =>
      inbox.pending({ page: 1, limit: 1, search: target.docNo }),
    );
    expect(found.items.map((d) => d.id)).toEqual([target.id]);
    expect(found.total).toBe(1);
  });

  it('matches the requester as well as the document number', async () => {
    const id = await makeDoc(DocStatus.SUBMITTED);
    await listener.onSubmitted({ documentId: id });
    const found = await as(ids.approver, () => inbox.pending({ search: 'REQUEST' })); // case-insensitive
    expect(found.items.map((d) => d.id)).toContain(id);
  });

  it('returns nothing for a term no pending document matches', async () => {
    const id = await makeDoc(DocStatus.SUBMITTED);
    await listener.onSubmitted({ documentId: id });
    const none = await as(ids.approver, () => inbox.pending({ search: 'zzzz-no-such-document' }));
    expect(none.items).toHaveLength(0);
    // `total` is the size of the FILTERED set, so the paginator does not advertise pages of
    // results the search excluded.
    expect(none.total).toBe(0);
  });

  it('never widens the set a search runs over — the creator still sees nothing', async () => {
    // Searching must not become a way around eligibility or the self-approval exclusion.
    const id = await makeDoc(DocStatus.SUBMITTED);
    await listener.onSubmitted({ documentId: id });
    const doc = await orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);
    const forCreator = await as(ids.requester, () => inbox.pending({ search: doc.docNo }));
    expect(forCreator.items).toHaveLength(0);
  });

  it('swallows when there is nothing to start (stays put, no throw)', async () => {
    const id = await makeDoc(DocStatus.DRAFT);
    await expect(listener.onSubmitted({ documentId: id })).resolves.toBeUndefined();
    const doc = await orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);
    expect(doc.status).toBe(DocStatus.DRAFT);
  });
});
