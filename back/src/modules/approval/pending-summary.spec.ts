import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocStatus, Scope } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { materialiseRoute } from '../../test/route-fixture';
import { PERMISSIONS_KEY } from '../../auth/require-permissions.decorator';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { Company, Department } from '../multi-company/multi-company.entities';
import { WorkingTimeService } from '../multi-company/working-time.service';
import { Currency } from '../currency/currency.entities';
import { AppUser, Employee, UserCompanyRole } from '../rbac/rbac.entities';
import { BudgetTxn } from '../budget/budget.entities';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../document/document.entities';
import { DocumentService } from '../document/document.service';
import { ApprovalLog, Workflow, WorkflowStep } from './approval.entities';
import { ApprovalInboxController } from './approval-inbox.controller';
import { ApproverResolverService } from './approver-resolver.service';
import { DocumentRouteService } from './document-route.service';
import { SlaService } from './sla.service';
import { WorkflowStepResolver } from './workflow-step.resolver';
import { PendingSummaryService, rollUp, type PendingSummaryRow } from './pending-summary.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;
const DAY = 86_400_000;

/**
 * The department's weekly question, answered by what the reader may SEE (their DOC_VIEW scope),
 * not by what they must sign. Built on the seed so the route, the eligible approver and the SLA
 * are the ones production would compute.
 */
describe.skipIf(!hasDb)('pending-approvals summary (DB-backed)', () => {
  let orm: MikroORM;
  let svc: PendingSummaryService;
  let seq = 0;
  const ids = {
    company: '', other: '', proc: '', hr: '', otherDept: '', prType: '', tmpl: '', workflow: '',
    requester: '', approver: '', outsider: '',
  };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    const em = orm.em.fork();
    const company = await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF);
    ids.company = company.id;
    ids.proc = (await em.findOneOrFail(Department, { company: ids.company, deptCode: 'PROC' }, FILTER_OFF)).id;
    ids.hr = (await em.findOneOrFail(Department, { company: ids.company, deptCode: 'HR' }, FILTER_OFF)).id;
    ids.prType = (await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF)).id;
    const mapping = await em.findOneOrFail(DeptDocType, { department: ids.proc, documentType: ids.prType }, { populate: ['formTemplate', 'workflow'], ...FILTER_OFF });
    ids.tmpl = mapping.formTemplate.id;
    ids.workflow = mapping.workflow.id;
    ids.requester = (await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF)).id;
    // Whoever the seed's step 1 actually waits on — resolved, not assumed (see approval-inbox.spec).
    const step1 = await em.findOneOrFail(WorkflowStep, { workflow: ids.workflow, stepNo: 1 }, { populate: ['approverRole', 'approverUser'], ...FILTER_OFF });
    ids.approver = step1.approverUser
      ? step1.approverUser.id
      : (await em.findOneOrFail(UserCompanyRole, { role: step1.approverRole!.id, company: ids.company }, { populate: ['user'], ...FILTER_OFF })).user.id;

    // A user with no employee record, to see the username fallback; and a second company.
    const outsider = em.create(AppUser, { username: 'ps-outsider', email: 'ps-outsider@x', status: 'ACTIVE' });
    const cur = await em.findOneOrFail(Currency, { code: 'THB' }, FILTER_OFF);
    const other = em.create(Company, { code: 'PSO', nameTh: 'Other', taxId: '9', branchCode: '00000', baseCurrency: cur, isActive: true });
    const otherDept = em.create(Department, { company: other, deptCode: 'X', name: 'X', isActive: true });
    await em.flush();
    ids.outsider = outsider.id;
    ids.other = other.id;
    ids.otherDept = otherDept.id;

    const resolver = new ApproverResolverService(orm.em);
    const stepResolver = new WorkflowStepResolver(orm.em);
    const scope = new CompanyScopeService(orm.em);
    const sla = new SlaService(orm.em, new WorkingTimeService(scope), resolver, stepResolver);
    const documents = new DocumentService(orm.em, scope, null as never, null as never, null as never, null as never, null as never);
    svc = new PendingSummaryService(orm.em, scope, documents, new DocumentRouteService(orm.em, stepResolver, resolver), resolver, sla);
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  interface Spec {
    status?: DocStatus;
    department?: string;
    company?: string;
    createdBy?: string;
    submittedAt?: Date;
    currency?: string;
    grandTotal?: string;
    /** Open step 1 this long ago, so a 24h SLA is (or is not) blown. */
    stepOpenedAgoHours?: number;
  }

  async function doc(spec: Spec = {}): Promise<string> {
    const em = orm.em.fork();
    const submittedAt = spec.submittedAt ?? new Date();
    const d = em.create(Document, {
      docNo: `PS-${String(++seq).padStart(3, '0')}`,
      company: em.getReference(Company, spec.company ?? ids.company),
      department: em.getReference(Department, spec.department ?? ids.proc),
      documentType: em.getReference(DocumentType, ids.prType),
      formTemplate: em.getReference(FormTemplate, ids.tmpl),
      workflow: em.getReference(Workflow, ids.workflow),
      createdBy: em.getReference(AppUser, spec.createdBy ?? ids.requester),
      currency: spec.currency ? em.getReference(Currency, spec.currency) : undefined,
      status: spec.status ?? DocStatus.IN_APPROVAL,
      currentStepNo: spec.status === DocStatus.IN_APPROVAL || !spec.status ? 1 : 0,
      grandTotal: spec.grandTotal ?? '100.00',
      baseTotalAmount: spec.grandTotal ?? '100.00',
      submittedAt,
      createdAt: submittedAt,
    } as never);
    await em.flush();
    if ((spec.status ?? DocStatus.IN_APPROVAL) === DocStatus.IN_APPROVAL) {
      const openedAt = spec.stepOpenedAgoHours != null ? new Date(Date.now() - spec.stepOpenedAgoHours * 3_600_000) : submittedAt;
      await materialiseRoute(orm, d.id, 1, openedAt);
    }
    return d.id;
  }

  const as = <T>(scope: Scope, fn: () => Promise<T>, departmentId = ids.proc, userId = ids.outsider) =>
    RequestContext.run({ userId, companyId: ids.company, departmentId, grants: [{ code: 'DOC_VIEW', scope }] }, fn);
  const docNos = (rows: PendingSummaryRow[]) => rows.map((r) => r.docNo);
  const docNoOf = async (id: string) => (await orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF)).docNo;

  it('shows a DEPARTMENT-scope reader their department\'s document, waiting on someone else, and not another department\'s', async () => {
    const mine = await doc({ department: ids.proc });
    const theirs = await doc({ department: ids.hr });
    const s = await as(Scope.DEPARTMENT, () => svc.summary());
    const nos = docNos(s.rows);
    expect(nos).toContain(await docNoOf(mine));
    expect(nos).not.toContain(await docNoOf(theirs));
    const row = s.rows.find((r) => r.documentId === mine)!;
    // Waiting on the seed's step-1 approver, who is not the reader.
    expect(row.waitingOn.map((a) => a.userId)).toContain(ids.approver);
    expect(row.department.deptCode).toBe('PROC');
    expect(row.currentStepNo).toBe(1);
  });

  it('shows a COMPANY-scope reader the whole company and nothing of another', async () => {
    const proc = await doc({ department: ids.proc });
    const hr = await doc({ department: ids.hr });
    const foreign = await doc({ company: ids.other, department: ids.otherDept });
    const nos = docNos((await as(Scope.COMPANY, () => svc.summary())).rows);
    expect(nos).toEqual(expect.arrayContaining([await docNoOf(proc), await docNoOf(hr)]));
    expect(nos).not.toContain(await docNoOf(foreign));
  });

  it('lists only documents still in approval', async () => {
    const parked = await doc({ status: DocStatus.SUBMITTED });
    const done = await doc({ status: DocStatus.COMPLETED });
    const draft = await doc({ status: DocStatus.DRAFT });
    const nos = docNos((await as(Scope.COMPANY, () => svc.summary())).rows);
    for (const id of [parked, done, draft]) expect(nos).not.toContain(await docNoOf(id));
  });

  it('narrows to a week of submissions, inclusive of the last day', async () => {
    const inWeek = await doc({ submittedAt: new Date('2026-03-08T16:59:00Z') }); // Sun 8 Mar 23:59 Bangkok
    const after = await doc({ submittedAt: new Date('2026-03-08T17:30:00Z') }); // Mon 9 Mar 00:30 Bangkok
    const before = await doc({ submittedAt: new Date('2026-03-01T10:00:00Z') });
    const nos = docNos((await as(Scope.COMPANY, () => svc.summary({ submittedFrom: '2026-03-02', submittedTo: '2026-03-08' }))).rows);
    expect(nos).toContain(await docNoOf(inWeek));
    expect(nos).not.toContain(await docNoOf(after));
    expect(nos).not.toContain(await docNoOf(before));
  });

  it('combines department and overdue-only, and keeps the facets unfiltered', async () => {
    const overdueProc = await doc({ department: ids.proc, stepOpenedAgoHours: 24 * 10 });
    const onTimeProc = await doc({ department: ids.proc, stepOpenedAgoHours: 1 });
    const overdueHr = await doc({ department: ids.hr, stepOpenedAgoHours: 24 * 10 });
    const s = await as(Scope.COMPANY, () => svc.summary({ departmentId: ids.proc, overdueOnly: true }));
    const nos = docNos(s.rows);
    expect(nos).toContain(await docNoOf(overdueProc));
    expect(nos).not.toContain(await docNoOf(onTimeProc));
    expect(nos).not.toContain(await docNoOf(overdueHr));
    expect(s.rows.every((r) => r.overdue)).toBe(true);
    // Facets describe what the reader COULD look at, not what they filtered to.
    expect(s.facets.departments.map((d) => d.deptCode)).toEqual(expect.arrayContaining(['PROC', 'HR']));
    expect(s.meta.departmentName).toBe('Procurement');
  });

  it('matches nothing for a department of another company', async () => {
    await doc({});
    const s = await as(Scope.COMPANY, () => svc.summary({ departmentId: ids.otherDept }));
    expect(s.rows).toEqual([]);
    expect(s.totals.pendingCount).toBe(0);
  });

  it('names the requester by employee full name, else by username', async () => {
    const byEmployee = await doc({ createdBy: ids.requester });
    const byUser = await doc({ createdBy: ids.outsider });
    const rows = (await as(Scope.COMPANY, () => svc.summary())).rows;
    expect(rows.find((r) => r.documentId === byEmployee)?.requesterName).toBe('Demo Requester');
    expect(rows.find((r) => r.documentId === byUser)?.requesterName).toBe('ps-outsider');
  });

  it('orders the longest wait first and counts days', async () => {
    const old = await doc({ submittedAt: new Date(Date.now() - 20 * DAY) });
    const mid = await doc({ submittedAt: new Date(Date.now() - 12 * DAY) });
    const fresh = await doc({ submittedAt: new Date(Date.now() - 3 * DAY) });
    const rows = (await as(Scope.COMPANY, () => svc.summary({ submittedFrom: '2000-01-01' }))).rows;
    const pos = (id: string) => rows.findIndex((r) => r.documentId === id);
    expect(pos(old)).toBeLessThan(pos(mid));
    expect(pos(mid)).toBeLessThan(pos(fresh));
    expect(rows.find((r) => r.documentId === old)?.waitingDays).toBe(20);
  });

  it('totals per currency and never across', async () => {
    const em = orm.em.fork();
    if (!(await em.findOne(Currency, { code: 'USD' }))) {
      em.create(Currency, { code: 'USD', name: 'US Dollar', decimalPlaces: 2, isActive: true });
      await em.flush();
    }
    const a = await doc({ department: ids.hr, currency: 'USD', grandTotal: '100.00' });
    const b = await doc({ department: ids.hr, grandTotal: '250.00' });
    const s = await as(Scope.COMPANY, () => svc.summary({ departmentId: ids.hr }));
    const hrRows = s.rows.filter((r) => [a, b].includes(r.documentId));
    expect(hrRows.find((r) => r.documentId === a)?.currencyCode).toBe('USD');
    expect(s.totals.amounts.USD).toBe('100');
    expect(s.byDepartment.find((d) => d.deptCode === 'HR')?.totals.USD).toBe('100');
    expect(s.meta.decimalPlaces).toMatchObject({ USD: 2 });
  });

  it('writes nothing', async () => {
    await doc({});
    const em = orm.em.fork();
    const count = async () => Promise.all([
      em.count(Document, {}, FILTER_OFF), em.count(ApprovalLog, {}, FILTER_OFF), em.count(BudgetTxn, {}, FILTER_OFF),
    ]);
    const before = await count();
    await as(Scope.COMPANY, () => svc.summary());
    expect(await count()).toEqual(before);
  });
});

describe('pending summary roll-ups', () => {
  const row = (over: Partial<PendingSummaryRow>): PendingSummaryRow => ({
    documentId: 'd', docNo: 'D', documentType: { id: 't', code: 'PR', name: 'PR' },
    department: { id: 'a', deptCode: 'A', name: 'A' }, requesterName: 'r', submittedAt: null, waitingDays: 1,
    currentStepNo: 1, stepName: null, waitingOn: [], currencyCode: 'LAK', grandTotal: '0', slaDueAt: null, overdue: false,
    ...over,
  });

  it('sums per currency and counts a document once in totals but under each approver it waits on', () => {
    const r = rollUp([
      row({ docNo: '1', grandTotal: '1000000', waitingOn: [{ userId: 'u1', name: 'One' }, { userId: 'u2', name: 'Two' }], waitingDays: 9 }),
      row({ docNo: '2', grandTotal: '500000', waitingOn: [{ userId: 'u1', name: 'One' }], overdue: true }),
      row({ docNo: '3', grandTotal: '100', currencyCode: 'USD', department: { id: 'b', deptCode: 'B', name: 'B' } }),
    ]);
    expect(r.totals).toEqual({ pendingCount: 3, overdueCount: 1, amounts: { LAK: '1500000', USD: '100' } });
    expect(r.byApprover).toEqual([
      { userId: 'u1', name: 'One', pendingCount: 2, oldestWaitingDays: 9 },
      { userId: 'u2', name: 'Two', pendingCount: 1, oldestWaitingDays: 9 },
    ]);
    expect(r.byDepartment.map((d) => [d.deptCode, d.pendingCount, d.totals])).toEqual([
      ['A', 2, { LAK: '1500000' }],
      ['B', 1, { USD: '100' }],
    ]);
    expect(r.byStep).toEqual([{ stepNo: 1, stepName: null, pendingCount: 3, oldestWaitingDays: 9 }]);
  });
});

describe('pending summary routes', () => {
  it('are gated by DOC_VIEW while the inbox stays DOC_APPROVE', () => {
    const h = ApprovalInboxController.prototype as unknown as Record<string, object>;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, h.pendingSummary)).toEqual(['DOC_VIEW']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, h.pendingSummaryXlsx)).toEqual(['DOC_VIEW']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, h.pending)).toEqual(['DOC_APPROVE']);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[pending-summary] no database reachable — skipping DB-backed spec');
}
