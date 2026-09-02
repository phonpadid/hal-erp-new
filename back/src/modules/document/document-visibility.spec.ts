import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ApproveAction, DocCategory, DocStatus, Scope } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Currency } from '../currency/currency.entities';
import { AppUser, Role, UserCompanyRole } from '../rbac/rbac.entities';
import {
  ApprovalDelegation,
  ApprovalLog,
  DocumentApprovalStep,
  DocumentApprovalStepActor,
  Workflow,
  WorkflowStep,
} from '../approval/approval.entities';
import { ApproverResolverService } from '../approval/approver-resolver.service';
import { ApprovalInboxService } from '../approval/approval-inbox.service';
import { ApprovalRoutingService } from '../approval/approval-routing.service';
import { DocumentRouteService } from '../approval/document-route.service';
import { SlaService } from '../approval/sla.service';
import { WorkflowStepResolver } from '../approval/workflow-step.resolver';
import { WorkingTimeService } from '../multi-company/working-time.service';
import { Document, DocumentType, FormTemplate } from './document.entities';
import { DocumentService } from './document.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Who may see a document.
 *
 * `rbac`'s Data Scope Enforcement has required this since it was written — "every data query MUST
 * filter by the active company first, then by scope" — and `ScopeService.scopeWhere` implemented it,
 * with unit tests. No service ever called it, so every reader saw the whole company and the only
 * test of scoping tested the function rather than the list. These test the list.
 *
 * The second half is the part a pure scope filter gets wrong: approving IS work on other
 * departments' documents, so a scope that hid them would make the correct configuration unable to
 * do its job.
 */
describe.skipIf(!hasDb)('document visibility (DB-backed)', () => {
  let orm: MikroORM;
  let svc: DocumentService;
  let seq = 0;

  const ids = {
    companyA: '', companyB: '', deptIt: '', deptAdm: '', deptB: '',
    dt: '', tmpl: '', wf: '',
    alice: '', bob: '', carol: '', approver: '', later: '',
  };

  /** Act as a user with a `DOC_VIEW` grant at one scope, in one department. */
  const as = <T>(userId: string, departmentId: string, scope: Scope, fn: () => Promise<T>, companyId = ids.companyA) =>
    RequestContext.run(
      { userId, companyId, departmentId, grants: [{ code: 'DOC_VIEW', scope }] },
      fn,
    );

  async function doc(createdBy: string, departmentId: string, companyId = ids.companyA): Promise<string> {
    const em = orm.em.fork();
    const d = em.create(Document, {
      docNo: `V-${seq++}`,
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, departmentId),
      documentType: em.getReference(DocumentType, ids.dt),
      formTemplate: em.getReference(FormTemplate, ids.tmpl),
      workflow: em.getReference(Workflow, ids.wf),
      createdBy: em.getReference(AppUser, createdBy),
      exchangeRate: '1',
      totalAmount: '10',
      baseTotalAmount: '10',
      status: DocStatus.DRAFT,
      createdAt: new Date(),
    } as never);
    await em.flush();
    return d.id;
  }

  /** Record that `userId` acted on the document — the append-only half of "party to". */
  async function acted(documentId: string, userId: string, action = ApproveAction.APPROVE): Promise<void> {
    const em = orm.em.fork();
    em.create(ApprovalLog, {
      document: em.getReference(Document, documentId),
      stepNo: 1,
      approver: em.getReference(AppUser, userId),
      action,
      actedAt: new Date(),
    } as never);
    await em.flush();
  }

  /** Open a route step naming `userId` — the "it is in my queue" half. */
  async function assignedTo(documentId: string, userId: string, superseded = false): Promise<void> {
    const em = orm.em.fork();
    const step = em.create(DocumentApprovalStep, {
      document: em.getReference(Document, documentId),
      stepNo: 1,
      approveMode: 'SEQUENTIAL',
      showSignatureOnPdf: true,
      requiresPaymentSlip: false,
      status: 'PENDING',
      createdAt: new Date(),
      supersededAt: superseded ? new Date() : undefined,
    } as never);
    await em.flush();
    em.create(DocumentApprovalStepActor, {
      step: em.getReference(DocumentApprovalStep, step.id),
      user: em.getReference(AppUser, userId),
    } as never);
    await em.flush();
  }

  const listIds = async (userId: string, dept: string, scope: Scope, q: Record<string, unknown> = {}, companyId = ids.companyA) =>
    (await as(userId, dept, scope, () => svc.list(q as never), companyId)).items.map((d) => d.id);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const cur = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const a = em.create(Company, { code: 'VA', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: cur, isActive: true });
    const b = em.create(Company, { code: 'VB', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: cur, isActive: true });
    const it = em.create(Department, { company: a, deptCode: 'IT', name: 'IT', isActive: true });
    const adm = em.create(Department, { company: a, deptCode: 'ADM', name: 'ADM', isActive: true });
    const bDept = em.create(Department, { company: b, deptCode: 'X', name: 'X', isActive: true });
    const role = em.create(Role, { company: a, code: 'R', name: 'R', isActive: true });
    const mk = (n: string) => em.create(AppUser, { username: n, email: `${n}@x`, status: 'ACTIVE' });
    const alice = mk('v-alice');
    const bob = mk('v-bob');
    const carol = mk('v-carol');
    const approver = mk('v-approver');
    const later = mk('v-later');
    for (const u of [alice, bob, carol, approver, later]) {
      em.create(UserCompanyRole, { user: u, company: a, department: it, role, isDefault: false });
    }
    const dt = em.create(DocumentType, {
      company: a, code: 'VMEMO', name: 'Memo', category: DocCategory.ADMIN,
      requiresBudget: false, requiresQuota: false, isActive: true,
    });
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company: a, name: 'V-WF', isActive: true });
    await em.flush();
    Object.assign(ids, {
      companyA: a.id, companyB: b.id, deptIt: it.id, deptAdm: adm.id, deptB: bDept.id,
      dt: dt.id, tmpl: tmpl.id, wf: wf.id,
      alice: alice.id, bob: bob.id, carol: carol.id, approver: approver.id, later: later.id,
    });

    svc = new DocumentService(
      orm.em,
      new CompanyScopeService(orm.em),
      null as never, null as never, null as never, null as never, null as never,
    );
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  // ---- scope ----------------------------------------------------------------

  it('OWN returns only what the reader raised', async () => {
    const mine = await doc(ids.alice, ids.deptIt);
    const theirs = await doc(ids.bob, ids.deptIt);
    const seen = await listIds(ids.alice, ids.deptIt, Scope.OWN);
    expect(seen).toContain(mine);
    expect(seen).not.toContain(theirs);
  });

  it('DEPARTMENT returns the department, and not another one', async () => {
    const inIt = await doc(ids.bob, ids.deptIt);
    const inAdm = await doc(ids.carol, ids.deptAdm);
    const seen = await listIds(ids.alice, ids.deptIt, Scope.DEPARTMENT);
    expect(seen).toContain(inIt);
    expect(seen).not.toContain(inAdm);
  });

  it('COMPANY returns every department of the active company', async () => {
    const inIt = await doc(ids.bob, ids.deptIt);
    const inAdm = await doc(ids.carol, ids.deptAdm);
    const seen = await listIds(ids.alice, ids.deptIt, Scope.COMPANY);
    expect(seen).toEqual(expect.arrayContaining([inIt, inAdm]));
  });

  it('COMPANY still stops at the company boundary', async () => {
    const here = await doc(ids.bob, ids.deptIt);
    const elsewhere = await doc(ids.bob, ids.deptB, ids.companyB);
    const seen = await listIds(ids.alice, ids.deptIt, Scope.COMPANY);
    expect(seen).toContain(here);
    expect(seen).not.toContain(elsewhere);
  });

  it('an ungranted DOC_VIEW collapses to OWN rather than to everything', async () => {
    // `scopeWhere` is fail-safe by design. The failure mode that matters is the opposite one.
    const mine = await doc(ids.alice, ids.deptIt);
    const theirs = await doc(ids.bob, ids.deptIt);
    const seen = await RequestContext.run(
      { userId: ids.alice, companyId: ids.companyA, departmentId: ids.deptIt, grants: [] },
      () => svc.list({}),
    );
    const seenIds = seen.items.map((d) => d.id);
    expect(seenIds).toContain(mine);
    expect(seenIds).not.toContain(theirs);
  });

  it('a narrowing scope with no value to narrow by returns nothing, and does not error', async () => {
    // OWN with no user on the context used to reach Postgres as `created_by = ''` and raise
    // `invalid input syntax for type uuid` — a 500 for a read the caller may simply not make.
    await doc(ids.bob, ids.deptIt);
    const seen = await RequestContext.run(
      { userId: '', companyId: ids.companyA, departmentId: ids.deptIt, grants: [] },
      () => svc.list({}),
    );
    expect(seen.items).toHaveLength(0);
  });

  // ---- party to the document ------------------------------------------------

  it('a document assigned to the reader is visible whatever their scope', async () => {
    const other = await doc(ids.bob, ids.deptAdm);
    await assignedTo(other, ids.approver);
    const seen = await listIds(ids.approver, ids.deptIt, Scope.OWN);
    expect(seen).toContain(other);
  });

  it('a document the reader approved stays visible afterwards', async () => {
    const other = await doc(ids.bob, ids.deptAdm);
    await acted(other, ids.approver, ApproveAction.APPROVE);
    expect(await listIds(ids.approver, ids.deptIt, Scope.OWN)).toContain(other);
  });

  it('a document the reader rejected or returned stays visible too', async () => {
    const rejected = await doc(ids.bob, ids.deptAdm);
    await acted(rejected, ids.approver, ApproveAction.REJECT);
    const returned = await doc(ids.bob, ids.deptAdm);
    await acted(returned, ids.approver, ApproveAction.RETURN);
    const seen = await listIds(ids.approver, ids.deptIt, Scope.OWN);
    expect(seen).toEqual(expect.arrayContaining([rejected, returned]));
  });

  it('a document whose route has not reached the reader stays hidden', async () => {
    // Named on a later step, but no step has opened for them and nothing is logged.
    const other = await doc(ids.bob, ids.deptAdm);
    expect(await listIds(ids.later, ids.deptIt, Scope.OWN)).not.toContain(other);
  });

  it('a superseded step does not keep a document visible', async () => {
    // A returned-and-resubmitted document supersedes its route. The old assignment is history, not
    // a standing claim on the document.
    const other = await doc(ids.bob, ids.deptAdm);
    await assignedTo(other, ids.later, true);
    expect(await listIds(ids.later, ids.deptIt, Scope.OWN)).not.toContain(other);
  });

  it('involvement never reaches across a company', async () => {
    const elsewhere = await doc(ids.bob, ids.deptB, ids.companyB);
    await acted(elsewhere, ids.approver);
    const seen = await listIds(ids.approver, ids.deptIt, Scope.OWN);
    expect(seen).not.toContain(elsewhere);
  });

  // ---- the list and the single read agree -----------------------------------

  it('a document the list hides cannot be read by id', async () => {
    const theirs = await doc(ids.bob, ids.deptAdm);
    await expect(as(ids.alice, ids.deptIt, Scope.OWN, () => svc.get(theirs))).rejects.toThrow(NotFoundException);
    await expect(as(ids.alice, ids.deptIt, Scope.OWN, () => svc.detail(theirs))).rejects.toThrow(NotFoundException);
    await expect(as(ids.alice, ids.deptIt, Scope.OWN, () => svc.assertVisible(theirs))).rejects.toThrow(NotFoundException);
  });

  it('a document the list shows can be read by id', async () => {
    const mine = await doc(ids.alice, ids.deptIt);
    expect((await as(ids.alice, ids.deptIt, Scope.OWN, () => svc.get(mine))).id).toBe(mine);
    await expect(as(ids.alice, ids.deptIt, Scope.OWN, () => svc.assertVisible(mine))).resolves.toBeUndefined();
  });

  it('the content reads follow the same rule as the list', async () => {
    // `assertVisible` is what guards the PDF, the attachments and the 3-way match. Those return a
    // document's CONTENT and used to resolve by id within the company alone, so the list could hide
    // a document while its PDF stayed one URL away.
    const theirs = await doc(ids.bob, ids.deptAdm);
    await assignedTo(theirs, ids.approver);
    await expect(as(ids.approver, ids.deptIt, Scope.OWN, () => svc.assertVisible(theirs))).resolves.toBeUndefined();
    await expect(as(ids.alice, ids.deptIt, Scope.OWN, () => svc.assertVisible(theirs))).rejects.toThrow(NotFoundException);
  });

  // ---- the "mine" filter ----------------------------------------------------

  it('narrows a DEPARTMENT reader to their own', async () => {
    const mine = await doc(ids.alice, ids.deptIt);
    const colleague = await doc(ids.bob, ids.deptIt);
    const all = await listIds(ids.alice, ids.deptIt, Scope.DEPARTMENT);
    expect(all).toEqual(expect.arrayContaining([mine, colleague]));

    const onlyMine = await listIds(ids.alice, ids.deptIt, Scope.DEPARTMENT, { mine: true });
    expect(onlyMine).toContain(mine);
    expect(onlyMine).not.toContain(colleague);
  });

  it('narrows a COMPANY reader too', async () => {
    const mine = await doc(ids.alice, ids.deptIt);
    const theirs = await doc(ids.bob, ids.deptAdm);
    const onlyMine = await listIds(ids.alice, ids.deptIt, Scope.COMPANY, { mine: true });
    expect(onlyMine).toContain(mine);
    expect(onlyMine).not.toContain(theirs);
  });

  it('cannot widen what the reader may see', async () => {
    // `mine` is a filter. A document the predicate hides stays hidden with it set or unset.
    const theirs = await doc(ids.bob, ids.deptAdm);
    expect(await listIds(ids.alice, ids.deptIt, Scope.OWN, { mine: true })).not.toContain(theirs);
    expect(await listIds(ids.alice, ids.deptIt, Scope.OWN, { mine: false })).not.toContain(theirs);
  });

  it('combines with the other filters', async () => {
    const mineDraft = await doc(ids.alice, ids.deptIt);
    const seen = await listIds(ids.alice, ids.deptIt, Scope.DEPARTMENT, { mine: true, status: [DocStatus.DRAFT] });
    expect(seen).toContain(mineDraft);
    const none = await listIds(ids.alice, ids.deptIt, Scope.DEPARTMENT, { mine: true, status: [DocStatus.COMPLETED] });
    expect(none).not.toContain(mineDraft);
  });

  // ---- the invariant that keeps the two halves from drifting --------------------

  /**
   * EVERY user the approval engine considers eligible must be able to open the document.
   *
   * This is the test that would have caught the bug this section was written for. Eligibility lives
   * in `ApproverResolverService.eligible` and visibility lives in `DocumentService`, and nothing
   * connected them — so when the predicate covered recorded principals but not delegates or
   * escalation targets, both halves passed their own tests while a stand-in approver got the
   * document in their inbox and a 404 when they opened it. It broke exactly when somebody was
   * away, which is when a stand-in is the whole point.
   *
   * Asserted as a property over all three kinds at once, so a FOURTH kind added later fails here
   * rather than in front of whoever is covering for a colleague.
   */
  it('everyone the approval engine calls eligible can open the document', async () => {
    const em = orm.em.fork();
    const resolver = new ApproverResolverService(em);

    const target = await doc(ids.bob, ids.deptAdm);
    // A live step with a recorded principal, an escalation target, and a delegation to a third.
    const step = em.create(DocumentApprovalStep, {
      document: em.getReference(Document, target),
      stepNo: 1,
      approveMode: 'SEQUENTIAL',
      showSignatureOnPdf: true,
      requiresPaymentSlip: false,
      status: 'PENDING',
      approverUser: em.getReference(AppUser, ids.approver),
      escalatedToUser: em.getReference(AppUser, ids.later),
      startedAt: new Date(),
      createdAt: new Date(),
    } as never);
    await em.flush();
    em.create(DocumentApprovalStepActor, {
      step: em.getReference(DocumentApprovalStep, step.id),
      user: em.getReference(AppUser, ids.approver),
    } as never);
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    em.create(ApprovalDelegation, {
      company: em.getReference(Company, ids.companyA),
      delegator: em.getReference(AppUser, ids.approver),
      delegate: em.getReference(AppUser, ids.carol),
      status: 'ACTIVE',
      startDate: today,
      endDate: tomorrow,
      createdAt: new Date(),
    } as never);
    await em.flush();

    const document = await em.findOneOrFail(
      Document,
      { id: target },
      { ...FILTER_OFF, populate: ['company', 'documentType'] },
    );
    const eligible = await resolver.eligible(
      await em.findOneOrFail(DocumentApprovalStep, { id: step.id }, { ...FILTER_OFF, populate: ['approverUser', 'approverRole', 'escalatedToUser'] }),
      document,
    );

    // All three kinds are actually present — otherwise this would pass by testing nothing.
    expect(eligible.map((a) => a.userId)).toEqual(
      expect.arrayContaining([ids.approver, ids.carol, ids.later]),
    );

    for (const actor of eligible) {
      await expect(
        as(actor.userId, ids.deptIt, Scope.OWN, () => svc.assertVisible(target)),
        `eligible approver ${actor.userId} cannot open the document they are asked to approve`,
      ).resolves.toBeUndefined();
    }
  });

  it('a delegation does not open the delegator\u2019s other work', async () => {
    // Visibility mirrors the authority it exists to serve, and no wider: a delegation limited by
    // amount is not a licence to read what it does not cover.
    //
    // Fresh principals on both sides. The specs in this file share one schema, so reusing a user who
    // already holds an unlimited delegation would let that one cover the document and the assertion
    // would pass for the wrong reason.
    const em = orm.em.fork();
    const away = em.create(AppUser, { username: 'v-away', email: 'v-away@x', status: 'ACTIVE' } as never);
    const cover = em.create(AppUser, { username: 'v-cover', email: 'v-cover@x', status: 'ACTIVE' } as never);
    await em.flush();

    const dear = await doc(ids.alice, ids.deptAdm);
    const stepRow = em.create(DocumentApprovalStep, {
      document: em.getReference(Document, dear),
      stepNo: 1, approveMode: 'SEQUENTIAL', showSignatureOnPdf: true, requiresPaymentSlip: false,
      status: 'PENDING', startedAt: new Date(), createdAt: new Date(),
    } as never);
    await em.flush();
    em.create(DocumentApprovalStepActor, {
      step: em.getReference(DocumentApprovalStep, stepRow.id),
      user: away,
    } as never);
    const today = new Date().toISOString().slice(0, 10);
    em.create(ApprovalDelegation, {
      company: em.getReference(Company, ids.companyA),
      delegator: away,
      delegate: cover,
      status: 'ACTIVE',
      startDate: today,
      endDate: today,
      amountLimit: '1',
      createdAt: new Date(),
    } as never);
    await em.flush();

    // The document is worth 10; the delegation covers 1.
    expect(await listIds(cover.id, ids.deptIt, Scope.OWN)).not.toContain(dear);

    // ...and the same delegation without the ceiling does reach it, so the assertion above is about
    // the limit rather than about the delegation being ignored entirely.
    const em2 = orm.em.fork();
    const wide = await em2.findOneOrFail(ApprovalDelegation, { delegate: cover.id }, FILTER_OFF);
    wide.amountLimit = undefined;
    await em2.flush();
    expect(await listIds(cover.id, ids.deptIt, Scope.OWN)).toContain(dear);
  });

  // ---- narrowing a READ must not narrow an ACTION ------------------------------

  it('an approver at OWN scope can still approve somebody else\u2019s document', async () => {
    // The rule this guards: scope governs what a person may BROWSE. Authority is decided by
    // permission codes and by the workflow. If narrowing reads had leaked into the approve path,
    // tightening visibility would have quietly revoked approvals — a permission change nobody
    // asked for, arriving through a read filter.
    const em = orm.em.fork();
    const resolver = new ApproverResolverService(em);
    const route = new DocumentRouteService(em, new WorkflowStepResolver(em), resolver);
    const routing = new ApprovalRoutingService(
      em,
      resolver,
      { assertApprovable: async () => undefined, run: async () => ({ paymentReady: false, stockTxnIds: [] }) } as never,
      { releaseDocumentHolds: async () => undefined } as never,
      route,
    );

    const wf = em.create(Workflow, { company: em.getReference(Company, ids.companyA), name: `V-ACT-${seq++}`, isActive: true } as never);
    em.create(WorkflowStep, {
      workflow: wf, stepNo: 1, approveMode: 'SEQUENTIAL', showSignatureOnPdf: true,
      requiresPaymentSlip: false, approverUser: em.getReference(AppUser, ids.approver),
    } as never);
    await em.flush();

    const target = em.create(Document, {
      docNo: `V-ACT-${seq++}`,
      company: em.getReference(Company, ids.companyA),
      department: em.getReference(Department, ids.deptAdm),
      documentType: em.getReference(DocumentType, ids.dt),
      formTemplate: em.getReference(FormTemplate, ids.tmpl),
      workflow: wf,
      currentStepNo: 0,
      createdBy: em.getReference(AppUser, ids.bob),
      exchangeRate: '1', totalAmount: '10', baseTotalAmount: '10',
      status: DocStatus.SUBMITTED, submittedAt: new Date(), createdAt: new Date(),
    } as never);
    await em.flush();

    await routing.start(target.id);
    // `act` returns nothing; the document is the evidence that it worked.
    await as(ids.approver, ids.deptIt, Scope.OWN, () =>
      routing.act(target.id, { action: ApproveAction.APPROVE }),
    );

    const after = await orm.em.fork().findOneOrFail(Document, { id: target.id }, FILTER_OFF);
    expect(after.status).toBe(DocStatus.COMPLETED);
  });

  it('the approval inbox is not filtered by DOC_VIEW at all', async () => {
    // The inbox resolves eligibility itself and never consults the scope, so narrowing reads must
    // leave a queue exactly as long as it was. Asserted at both extremes: the same user, the same
    // documents, once at COMPANY and once at OWN.
    const em = orm.em.fork();
    const resolver = new ApproverResolverService(em);
    const route = new DocumentRouteService(em, new WorkflowStepResolver(em), resolver);
    const inbox = new ApprovalInboxService(
      em,
      resolver,
      new SlaService(em, new WorkingTimeService(new CompanyScopeService(em)), resolver, route),
      route,
    );

    const wide = await as(ids.approver, ids.deptIt, Scope.COMPANY, () => inbox.pending());
    const narrow = await as(ids.approver, ids.deptIt, Scope.OWN, () => inbox.pending());
    expect(narrow.total).toBe(wide.total);
    expect(narrow.items.map((i) => i.id).sort()).toEqual(wide.items.map((i) => i.id).sort());
  });
});

