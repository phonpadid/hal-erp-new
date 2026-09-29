import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus, IntakeAction, Scope } from '../../common/enums';
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
import { DeptDocType, Document, DocumentIntakeLog, DocumentType, FormTemplate } from '../document/document.entities';
import { DocumentService } from '../document/document.service';
import { Workflow } from './approval.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('approval inbox + auto-start (DB-backed)', () => {
  let orm: MikroORM;
  let inbox: ApprovalInboxService;
  let listener: ApprovalSubmittedListener;
  const ids = { company: '', dept: '', otherDept: '', prType: '', tmpl: '', workflow: '', requester: '', approver: '' };
  let seq = 0;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    const em = orm.em.fork();
    ids.company = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    ids.dept = (await em.findOneOrFail(Department, { company: ids.company, deptCode: 'PROC' }, FILTER_OFF)).id;
    ids.otherDept = (await em.findOneOrFail(Department, { company: ids.company, id: { $ne: ids.dept } }, FILTER_OFF)).id;
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
    // The export reaches the document module for the workbook rows; nothing else here needs it.
    const documents = new DocumentService(orm.em, scope, null as never, null as never, null as never, null as never, null as never);
    inbox = new ApprovalInboxService(orm.em, resolver, sla, new DocumentRouteService(orm.em, stepResolver, resolver), documents);
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
    // Named as the documents list names them — the employee, not the login.
    expect(forApprover.items.find((d) => d.id === id)!.requesterName).toBe('Demo Requester');

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

  /**
   * What the documents list asks before it draws an Approve button.
   *
   * Same service, same predicate as `pending` — these exist so the list can never be given an
   * answer the inbox would contradict, and so the self-approval exclusion is proved on the path
   * the screen actually uses.
   */
  describe('actionable: which of these rows may I act on', () => {
    it('includes a document whose open step names the caller', async () => {
      const id = await makeDoc(DocStatus.SUBMITTED);
      await listener.onSubmitted({ documentId: id });
      expect(await as(ids.approver, () => inbox.actionable([id]))).toEqual([id]);
    });

    it('excludes a document the caller raised, even though they may approve (invariant 8)', async () => {
      const id = await makeDoc(DocStatus.SUBMITTED);
      await listener.onSubmitted({ documentId: id });
      // `requester` raised it. Holding DOC_APPROVE is what gets them to this endpoint at all;
      // it must not get them an Approve button on their own request.
      expect(await as(ids.requester, () => inbox.actionable([id]))).toEqual([]);
    });

    it('excludes an approver whose step the route has not reached', async () => {
      const id = await makeDoc(DocStatus.SUBMITTED);
      await listener.onSubmitted({ documentId: id }); // opens step 1

      const em = orm.em.fork();
      const later = await em.findOneOrFail(
        WorkflowStep,
        { workflow: ids.workflow, stepNo: 2 },
        { populate: ['approverRole', 'approverUser'], ...FILTER_OFF },
      );
      const holder = later.approverUser
        ? later.approverUser
        : (
            await em.findOneOrFail(
              UserCompanyRole,
              { role: later.approverRole!.id, company: ids.company },
              { populate: ['user'], ...FILTER_OFF },
            )
          ).user;

      expect(await as(holder.id, () => inbox.actionable([id]))).toEqual([]);
    });

    it('excludes a document that is no longer in approval', async () => {
      const id = await makeDoc(DocStatus.SUBMITTED);
      await listener.onSubmitted({ documentId: id });
      const em = orm.em.fork();
      const doc = await em.findOneOrFail(Document, { id }, FILTER_OFF);
      doc.status = DocStatus.APPROVED;
      await em.flush();

      expect(await as(ids.approver, () => inbox.actionable([id]))).toEqual([]);
    });

    it('answers only about ids it was given, and silently drops ones it cannot see', async () => {
      const mine = await makeDoc(DocStatus.SUBMITTED);
      await listener.onSubmitted({ documentId: mine });
      const stranger = '00000000-0000-4000-8000-000000000000';

      const out = await as(ids.approver, () => inbox.actionable([mine, stranger]));
      expect(out).toEqual([mine]);
    });

    it('asks nothing of the database for an empty page', async () => {
      expect(await as(ids.approver, () => inbox.actionable([]))).toEqual([]);
    });
  });

  /**
   * The inbox's three filters, the intake state on its rows, and the payables export — each proved
   * against the actionable set, never beside it.
   *
   * Every document here is submitted in 2020, a year nothing else in this file touches, so a date
   * range isolates a test's own documents from the ones earlier tests left in the queue.
   */
  describe('filters, intake and export', () => {
    async function routed(o: { dept?: string; amount?: string; submittedAt: string; by?: string }): Promise<string> {
      const em = orm.em.fork();
      const doc = em.create(Document, {
        docNo: `PR-F-${++seq}`,
        company: em.getReference(Company, ids.company),
        department: em.getReference(Department, o.dept ?? ids.dept),
        documentType: em.getReference(DocumentType, ids.prType),
        formTemplate: em.getReference(FormTemplate, ids.tmpl),
        workflow: em.getReference(Workflow, ids.workflow),
        createdBy: em.getReference(AppUser, o.by ?? ids.requester),
        status: DocStatus.SUBMITTED,
        currentStepNo: 0,
        baseTotalAmount: o.amount ?? '100.00',
        submittedAt: new Date(o.submittedAt),
        createdAt: new Date(o.submittedAt),
      });
      await em.flush();
      await listener.onSubmitted({ documentId: doc.id });
      return doc.id;
    }

    const withIntake = <T>(userId: string, fn: () => Promise<T>) =>
      RequestContext.run(
        {
          userId,
          companyId: ids.company,
          departmentId: ids.dept,
          grants: [{ code: 'DOC_INTAKE_RECEIVE', scope: Scope.COMPANY }],
        },
        fn,
      );

    it('narrows by department across every page, and total follows', async () => {
      const window = { submittedFrom: '2020-01-06', submittedTo: '2020-01-06' };
      const other: string[] = [];
      for (let i = 0; i < 3; i++) other.push(await routed({ dept: ids.otherDept, submittedAt: '2020-01-06T03:00:00Z' }));
      for (let i = 0; i < 9; i++) await routed({ submittedAt: '2020-01-06T03:00:00Z' });

      const unfiltered = await as(ids.approver, () => inbox.pending({ ...window, limit: 10 }));
      expect(unfiltered.total).toBe(12);

      const page = await as(ids.approver, () =>
        inbox.pending({ ...window, departmentId: ids.otherDept, limit: 10 }),
      );
      expect(page.items.map((d) => d.id).sort()).toEqual([...other].sort());
      expect(page.total).toBe(3);
    });

    it('never surfaces a document the approver raised or may not act on', async () => {
      const window = { submittedFrom: '2020-02-03', submittedTo: '2020-02-03' };
      // Raised by the approver themselves: in approval, in the department, and still not theirs.
      await routed({ dept: ids.otherDept, submittedAt: '2020-02-03T03:00:00Z', by: ids.approver });
      // Parked in approval with no step opened for anyone.
      const em = orm.em.fork();
      const stranded = em.create(Document, {
        docNo: `PR-F-${++seq}`,
        company: em.getReference(Company, ids.company),
        department: em.getReference(Department, ids.otherDept),
        documentType: em.getReference(DocumentType, ids.prType),
        formTemplate: em.getReference(FormTemplate, ids.tmpl),
        workflow: em.getReference(Workflow, ids.workflow),
        createdBy: em.getReference(AppUser, ids.requester),
        status: DocStatus.IN_APPROVAL,
        currentStepNo: 99,
        baseTotalAmount: '100.00',
        submittedAt: new Date('2020-02-03T03:00:00Z'),
        createdAt: new Date('2020-02-03T03:00:00Z'),
      });
      await em.flush();

      const res = await as(ids.approver, () => inbox.pending({ ...window, departmentId: ids.otherDept }));
      expect(res.items.map((d) => d.id)).not.toContain(stranded.id);
      expect(res.total).toBe(0);
    });

    it("reads the submitted range as the company's calendar days, the last one inclusive", async () => {
      // 16:00 on 18 March in UTC+7 is 09:00Z; 03:00 on 19 March local is 20:00Z on the 18th.
      const onTheDay = await routed({ submittedAt: '2020-03-18T09:00:00Z' });
      const nextLocalDay = await routed({ submittedAt: '2020-03-18T20:00:00Z' });

      const res = await as(ids.approver, () =>
        inbox.pending({ submittedFrom: '2020-03-14', submittedTo: '2020-03-18' }),
      );
      const listed = res.items.map((d) => d.id);
      expect(listed).toContain(onTheDay);
      expect(listed).not.toContain(nextLocalDay);
    });

    it('compares amount bounds as decimals, not floats', async () => {
      const window = { submittedFrom: '2020-04-06', submittedTo: '2020-04-06' };
      const exact = await routed({ amount: '1000000.00', submittedAt: '2020-04-06T03:00:00Z' });
      const cent = await routed({ amount: '1000000.01', submittedAt: '2020-04-06T03:00:00Z' });

      const capped = await as(ids.approver, () => inbox.pending({ ...window, maxAmount: '1000000' }));
      expect(capped.items.map((d) => d.id)).toEqual([exact]);

      const floor = await as(ids.approver, () => inbox.pending({ ...window, minAmount: '1000000.01' }));
      expect(floor.items.map((d) => d.id)).toEqual([cent]);
    });

    it('carries each row’s intake state, and canReceive only for a reader who may receive', async () => {
      const window = { submittedFrom: '2020-05-04', submittedTo: '2020-05-04' };
      const received = await routed({ submittedAt: '2020-05-04T03:00:00Z' });
      const waiting = await routed({ submittedAt: '2020-05-04T03:00:00Z' });

      const em = orm.em.fork();
      em.create(DocumentIntakeLog, {
        company: em.getReference(Company, ids.company),
        document: em.getReference(Document, received),
        action: IntakeAction.RECEIVE,
        actor: em.getReference(AppUser, ids.requester),
        actedAt: new Date('2020-05-04T05:00:00Z'),
      });
      await em.flush();

      const res = await withIntake(ids.approver, () => inbox.pending(window));
      const row = (id: string) => res.items.find((d) => d.id === id)!;
      expect(row(received).intake).toMatchObject({ received: true, receivedByName: 'Demo Requester', canReceive: false });
      expect(row(received).intake.receivedAt).toBeTruthy();
      expect(row(waiting).intake).toMatchObject({ received: false, canReceive: true });

      // Without the code nobody is told they may receive — the column is not theirs to act on.
      const plain = await as(ids.approver, () => inbox.pending(window));
      expect(plain.items.every((d) => d.intake.canReceive === false)).toBe(true);
      expect(plain.items.find((d) => d.id === received)!.intake.received).toBe(true);
    });

    it('narrows to received or not-received, a reversed receipt counting as not received — and the export follows', async () => {
      const window = { submittedFrom: '2020-05-11', submittedTo: '2020-05-11' };
      const received = await routed({ submittedAt: '2020-05-11T03:00:00Z' });
      const reversed = await routed({ submittedAt: '2020-05-11T03:00:00Z' });
      const waiting = await routed({ submittedAt: '2020-05-11T03:00:00Z' });

      const em = orm.em.fork();
      const log = (document: string, action: IntakeAction, at: string) =>
        em.create(DocumentIntakeLog, {
          company: em.getReference(Company, ids.company),
          document: em.getReference(Document, document),
          action,
          actor: em.getReference(AppUser, ids.requester),
          actedAt: new Date(at),
        });
      log(received, IntakeAction.RECEIVE, '2020-05-11T05:00:00Z');
      log(reversed, IntakeAction.RECEIVE, '2020-05-11T05:00:00Z');
      log(reversed, IntakeAction.REVERSE, '2020-05-11T06:00:00Z');
      await em.flush();

      const ids_ = async (intake?: 'RECEIVED' | 'NOT_RECEIVED') =>
        (await as(ids.approver, () => inbox.pending({ ...window, intake }))).items.map((d) => d.id).sort();
      expect(await ids_('RECEIVED')).toEqual([received]);
      expect(await ids_('NOT_RECEIVED')).toEqual([reversed, waiting].sort());
      expect(await ids_()).toEqual([received, reversed, waiting].sort()); // no filter: all of them

      // Paging counts the filtered set, not the whole inbox.
      const page = await as(ids.approver, () => inbox.pending({ ...window, intake: 'NOT_RECEIVED', limit: 1 }));
      expect(page.total).toBe(2);

      // The export is cut from the same set: finance can pull only what reached their desk.
      const sheet = await as(ids.approver, () => inbox.exportPayables({ ...window, intake: 'RECEIVED' }));
      const docNo = (await orm.em.fork().findOneOrFail(Document, { id: received }, FILTER_OFF)).docNo;
      expect(sheet.rows.map((r) => r.docNo)).toEqual([docNo]);
    });

    it("names the requester's department beside their name", async () => {
      const id = await routed({ submittedAt: '2020-06-01T03:00:00Z' });
      const res = await as(ids.approver, () => inbox.pending({ submittedFrom: '2020-06-01', submittedTo: '2020-06-01' }));
      const row = res.items.find((d) => d.id === id)!;
      expect(row.requesterName).toBe('Demo Requester');
      expect(row.requesterDepartment).toBeTruthy();
    });

    it('exports exactly the whole filtered inbox, across pages, and nothing it would not list', async () => {
      const window = { submittedFrom: '2020-07-06', submittedTo: '2020-07-06' };
      const listed: string[] = [];
      for (let i = 0; i < 3; i++) listed.push(await routed({ dept: ids.otherDept, submittedAt: '2020-07-06T03:00:00Z' }));
      await routed({ submittedAt: '2020-07-06T03:00:00Z' }); // another department
      await routed({ dept: ids.otherDept, submittedAt: '2020-07-06T03:00:00Z', by: ids.approver }); // their own

      const filter = { ...window, departmentId: ids.otherDept, limit: 1 };
      const page = await as(ids.approver, () => inbox.pending(filter));
      expect(page.items).toHaveLength(1); // the screen shows one…

      const sheet = await as(ids.approver, () => inbox.exportPayables(filter));
      const docNos = (await orm.em.fork().find(Document, { id: { $in: listed } }, FILTER_OFF)).map((d) => d.docNo).sort();
      expect(sheet.rows.map((r) => r.docNo).sort()).toEqual(docNos); // …the sheet holds all three
      expect(sheet.fileName).toMatch(/^pending-approvals-payables-.+-\d{4}-\d{2}-\d{2}\.xlsx$/);
    });

    it('exports an empty sheet for an empty inbox, rather than failing', async () => {
      const sheet = await as(ids.approver, () =>
        inbox.exportPayables({ submittedFrom: '2020-08-03', submittedTo: '2020-08-03' }),
      );
      expect(sheet.rows).toEqual([]);
    });

    it('writes nothing when it exports', async () => {
      await routed({ submittedAt: '2020-09-07T03:00:00Z' });
      const before = await orm.em.fork().count(DocumentIntakeLog, {}, FILTER_OFF);
      await as(ids.approver, () => inbox.exportPayables({ submittedFrom: '2020-09-07', submittedTo: '2020-09-07' }));
      expect(await orm.em.fork().count(DocumentIntakeLog, {}, FILTER_OFF)).toBe(before);
    });
  });

  it('swallows when there is nothing to start (stays put, no throw)', async () => {
    const id = await makeDoc(DocStatus.DRAFT);
    await expect(listener.onSubmitted({ documentId: id })).resolves.toBeUndefined();
    const doc = await orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);
    expect(doc.status).toBe(DocStatus.DRAFT);
  });
});
