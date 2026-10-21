import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus, Scope } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Currency } from '../currency/currency.entities';
import { AppUser, Role, UserCompanyRole } from '../rbac/rbac.entities';
import {
  ApprovalDelegation,
  DocumentApprovalStep,
  DocumentApprovalStepActor,
  Workflow,
} from '../approval/approval.entities';
import { ApproverResolverService } from '../approval/approver-resolver.service';
import { ApprovalInboxService } from '../approval/approval-inbox.service';
import { DocumentRouteService } from '../approval/document-route.service';
import { SlaService } from '../approval/sla.service';
import { WorkflowStepResolver } from '../approval/workflow-step.resolver';
import { WorkingTimeService } from '../multi-company/working-time.service';
import { Document, DocumentType, FormTemplate } from './document.entities';
import { DocumentService } from './document.service';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * If the system lets you approve a document, it lets you read it.
 *
 * The approval inbox resolves a role step's holders LIVE; the document read admitted an approver only
 * through the `document_approval_step_actor` rows frozen when the step opened. So a person granted
 * the role after the step opened — or every holder, when the role had nobody at that moment — was
 * listed a document to approve and answered 404 on opening it. It happened on production in October
 * 2026 and was patched by hand, user by user.
 *
 * The actor rows stay frozen (a PARALLEL_ALL step must not gain a required approval mid-flight);
 * only the read is aligned with who may act.
 */
describe.skipIf(!hasDb)('an eligible approver can read the document (DB-backed)', () => {
  let orm: MikroORM;
  let seq = 0;
  const ids: Record<string, string> = {};

  const ctx = (userId: string, departmentId: string, scope: Scope, companyId = ids.companyA) => ({
    userId, companyId, departmentId, departmentIds: [departmentId],
    grants: [{ code: 'DOC_VIEW', scope }, { code: 'DOC_APPROVE', scope: Scope.OWN }],
  });
  const as = <T>(userId: string, fn: () => Promise<T>, scope = Scope.OWN, dept = ids.deptIt, companyId = ids.companyA) =>
    RequestContext.run(ctx(userId, dept, scope, companyId), fn);

  function services(em: EntityManager) {
    const resolver = new ApproverResolverService(em);
    const route = new DocumentRouteService(em, new WorkflowStepResolver(em), resolver);
    const scope = new CompanyScopeService(em);
    const documents = new DocumentService(
      em, scope, null as never, null as never, null as never, null as never, null as never,
      undefined, undefined, route, resolver,
    );
    const inbox = new ApprovalInboxService(
      em, resolver, new SlaService(em, new WorkingTimeService(scope), resolver, route), route,
    );
    return { documents, inbox };
  }
  const visible = (userId: string, documentId: string, scope = Scope.OWN, dept = ids.deptIt) =>
    as(userId, () => services(orm.em.fork()).documents.isVisible(documentId), scope, dept);

  /** An IN_APPROVAL document whose step 1 targets `roleId`, its actors frozen as `actors`. */
  async function pending(o: { roleId?: string; userId?: string; actors?: string[]; createdBy?: string; amount?: string; company?: string; dept?: string; type?: string; steps?: Array<{ stepNo: number; roleId: string }> }): Promise<string> {
    const em = orm.em.fork();
    const company = o.company ?? ids.companyA;
    const d = em.create(Document, {
      docNo: `LE-${++seq}`,
      company: em.getReference(Company, company),
      department: em.getReference(Department, o.dept ?? ids.deptAdm),
      documentType: em.getReference(DocumentType, o.type ?? ids.dt),
      formTemplate: em.getReference(FormTemplate, ids.tmpl),
      workflow: em.getReference(Workflow, company === ids.companyA ? ids.wf : ids.wfB),
      createdBy: em.getReference(AppUser, o.createdBy ?? ids.requester),
      exchangeRate: '1', totalAmount: o.amount ?? '10', baseTotalAmount: o.amount ?? '10',
      status: DocStatus.IN_APPROVAL, currentStepNo: 1, submittedAt: new Date(), createdAt: new Date(),
    } as never);
    await em.flush();
    const steps = o.steps ?? [{ stepNo: 1, roleId: o.roleId! }];
    for (const s of steps) {
      const step = em.create(DocumentApprovalStep, {
        document: d, stepNo: s.stepNo, approveMode: 'SEQUENTIAL', showSignatureOnPdf: true,
        requiresPaymentSlip: false, status: 'PENDING', createdAt: new Date(),
        startedAt: s.stepNo === 1 ? new Date() : undefined,
        approverRole: s.roleId ? em.getReference(Role, s.roleId) : undefined,
        approverUser: s.stepNo === 1 && o.userId ? em.getReference(AppUser, o.userId) : undefined,
      } as never);
      await em.flush();
      if (s.stepNo === 1) {
        for (const a of o.actors ?? []) {
          em.create(DocumentApprovalStepActor, { step, user: em.getReference(AppUser, a) } as never);
        }
      }
    }
    await em.flush();
    return d.id;
  }

  async function grant(userId: string, roleId: string, o: { dept?: string; company?: string; validTo?: string } = {}) {
    const em = orm.em.fork();
    em.create(UserCompanyRole, {
      user: em.getReference(AppUser, userId),
      company: em.getReference(Company, o.company ?? ids.companyA),
      department: em.getReference(Department, o.dept ?? ids.deptIt),
      role: em.getReference(Role, roleId),
      isDefault: false,
      validTo: o.validTo,
    } as never);
    await em.flush();
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const cur = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 0, isActive: true });
    const a = em.create(Company, { code: 'LA', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: cur, timezone: 'Asia/Bangkok', isActive: true });
    const b = em.create(Company, { code: 'LB', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: cur, timezone: 'Asia/Bangkok', isActive: true });
    const it = em.create(Department, { company: a, deptCode: 'IT', name: 'IT', isActive: true });
    const adm = em.create(Department, { company: a, deptCode: 'ADM', name: 'ADM', isActive: true });
    const bDept = em.create(Department, { company: b, deptCode: 'X', name: 'X', isActive: true });
    const role = (company: Company, code: string) => em.create(Role, { company, code, name: code, isActive: true });
    const r = role(a, 'HEAD');
    const empty = role(a, 'EMPTY');
    const r2 = role(a, 'LATER');
    const nobody = role(a, 'NOBODY');
    const rB = role(b, 'HEAD');
    const users = ['requester', 'first', 'late', 'stranger', 'laterHolder', 'expired', 'otherCo', 'principal', 'cover', 'q1'];
    for (const u of users) ids[u] = em.create(AppUser, { username: `le-${u}`, email: `${u}@x`, status: 'ACTIVE' }).id;
    const dt = em.create(DocumentType, { company: a, code: 'LEMEMO', name: 'Memo', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, isActive: true });
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company: a, name: 'LE-WF', isActive: true });
    const wfB = em.create(Workflow, { company: b, name: 'LE-WF-B', isActive: true });
    await em.flush();
    Object.assign(ids, {
      companyA: a.id, companyB: b.id, deptIt: it.id, deptAdm: adm.id, deptB: bDept.id,
      role: r.id, empty: empty.id, later: r2.id, nobody: nobody.id, roleB: rB.id,
      dt: dt.id, tmpl: tmpl.id, wf: wf.id, wfB: wfB.id,
    });
    await grant(ids.first, ids.role);
    await grant(ids.laterHolder, ids.later);
    await grant(ids.otherCo, ids.roleB, { company: ids.companyB, dept: ids.deptB });
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  it('a role granted after the step opened can read what it is now asked to approve', async () => {
    const id = await pending({ roleId: ids.role, actors: [ids.first] });
    await grant(ids.late, ids.role);

    const { documents, inbox } = services(orm.em.fork());
    const listed = await as(ids.late, () => inbox.pending({ limit: 100 } as never));
    expect(listed.items.map((i) => i.id)).toContain(id);
    expect(await visible(ids.late, id)).toBe(true);
    expect((await as(ids.late, () => documents.get(id))).id).toBe(id);
    expect((await as(ids.late, () => documents.list({} as never))).items.map((d) => d.id)).toContain(id);

    // Who must approve is unchanged: the frozen actors are still only the first holder.
    const actors = await orm.em.fork().find(DocumentApprovalStepActor, { step: { document: id } }, FILTER_OFF);
    expect(actors.map((x) => x.user.id)).toEqual([ids.first]);
  });

  it('a role that had no holders when the step opened', async () => {
    const id = await pending({ roleId: ids.empty, actors: [] });
    await grant(ids.stranger, ids.empty, { dept: ids.deptIt });
    // DEPARTMENT scope in IT; the document is in ADM.
    expect(await visible(ids.stranger, id, Scope.DEPARTMENT, ids.deptIt)).toBe(true);
  });

  it('a holder of a LATER step the route has not reached stays hidden', async () => {
    const id = await pending({ steps: [{ stepNo: 1, roleId: ids.nobody }, { stepNo: 2, roleId: ids.later }] });
    expect(await visible(ids.laterHolder, id)).toBe(false);
  });

  it('live eligibility ends when the route moves past the step', async () => {
    const id = await pending({ steps: [{ stepNo: 1, roleId: ids.role }, { stepNo: 2, roleId: ids.nobody }], actors: [ids.first] });
    expect(await visible(ids.late, id)).toBe(true);
    const em = orm.em.fork();
    const d = await em.findOneOrFail(Document, { id }, FILTER_OFF);
    d.currentStepNo = 2;
    await em.flush();
    expect(await visible(ids.late, id)).toBe(false);
  });

  it('an assignment whose valid_to has passed confers nothing', async () => {
    const id = await pending({ roleId: ids.empty, actors: [] });
    await grant(ids.expired, ids.empty, { validTo: '2000-01-01' });
    expect(await visible(ids.expired, id)).toBe(false);
  });

  it("a same-named role in another company adds nothing here", async () => {
    const id = await pending({ roleId: ids.role, actors: [ids.first] });
    expect(await visible(ids.otherCo, id)).toBe(false);
  });

  it('the creator is not made an approver, and still reads their document', async () => {
    const id = await pending({ roleId: ids.role, actors: [ids.first], createdBy: ids.late });
    const listed = await as(ids.late, () => services(orm.em.fork()).inbox.pending({ limit: 100 } as never));
    expect(listed.items.map((i) => i.id)).not.toContain(id);
    expect(await visible(ids.late, id)).toBe(true);
  });

  it('a document visible only through eligibility is still hidden from everyone else', async () => {
    const id = await pending({ roleId: ids.empty, actors: [] });
    await expect(as(ids.q1, () => services(orm.em.fork()).documents.get(id))).rejects.toThrow(NotFoundException);
  });

  it('every document the inbox lists, for every user, opens', async () => {
    const userIds = ['first', 'late', 'stranger', 'laterHolder', 'expired', 'otherCo', 'q1', 'requester'].map((k) => ids[k]);
    let checked = 0;
    for (const userId of userIds) {
      const listed = await as(userId, () => services(orm.em.fork()).inbox.pending({ limit: 1000 } as never));
      for (const row of listed.items) {
        checked += 1;
        expect(await visible(userId, row.id), `${userId} is asked to approve ${row.docNo} and cannot open it`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('reads the same number of times however many documents wait on the reader’s role', async () => {
    const count = async () => {
      const em = orm.em.fork();
      const conn = em.getConnection() as unknown as { execute: (...a: unknown[]) => Promise<unknown> };
      const original = conn.execute.bind(conn);
      let queries = 0;
      conn.execute = (...args: unknown[]) => { queries += 1; return original(...args); };
      try {
        await as(ids.late, () => services(em).documents.list({} as never));
      } finally {
        conn.execute = original;
      }
      return queries;
    };
    const before = await count();
    for (let i = 0; i < 10; i++) await pending({ roleId: ids.role, actors: [ids.first] });
    expect(await count()).toBe(before);
  });

  it("reads a delegation's window on the company's day, not UTC's", async () => {
    // UTC+7. The delegation ends on the 31st; 23:00 UTC on the 31st is already the 1st in the company.
    const id = await pending({ userId: ids.principal, actors: [ids.principal] });
    const em = orm.em.fork();
    em.create(ApprovalDelegation, {
      company: em.getReference(Company, ids.companyA),
      delegator: em.getReference(AppUser, ids.principal),
      delegate: em.getReference(AppUser, ids.cover),
      status: 'ACTIVE', startDate: '2026-03-01', endDate: '2026-03-31', createdAt: new Date(),
    } as never);
    await em.flush();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-03-31T01:00:00Z'));
      expect(await visible(ids.cover, id)).toBe(true);
      vi.setSystemTime(new Date('2026-03-31T23:00:00Z'));
      expect(await visible(ids.cover, id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
