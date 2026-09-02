import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { materialiseRoute } from '../../test/route-fixture';
import { Currency } from '../currency/currency.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser, Role, UserCompanyRole } from '../rbac/rbac.entities';
import { ApprovalRoutingService } from './approval-routing.service';
import { DocumentRouteService } from './document-route.service';
import { ApproverResolverService } from './approver-resolver.service';
import { ApprovalDelegation, Workflow, WorkflowStep } from './approval.entities';
import { WorkflowStepResolver } from './workflow-step.resolver';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FAR = '2999-12-31';

function asUser<T>(userId: string, companyId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId, companyId, departmentId: 'd', grants: [] }, fn);
}

describe.skipIf(!hasDb)('pending-approvers read (DB-backed)', () => {
  let orm: MikroORM;
  let routing: ApprovalRoutingService;
  const ids = {
    companyA: '', deptA: '', role: '',
    creator: '', outsider: '', r1: '', r2: '', delegator: '', delegate: '', chain: '',
    dt: '', tmpl: '',
  };
  let seq = 0;

  const ref = <T>(cls: new (...a: any[]) => T, id: string) => orm.em.getReference(cls as any, id) as any;

  async function workflow(steps: Array<Partial<WorkflowStep> & { stepNo: number }>): Promise<string> {
    const em = orm.em.fork();
    const wf = em.create(Workflow, { company: ref(Company, ids.companyA), name: `WF-${seq++}`, isActive: true });
    for (const s of steps) {
      em.create(WorkflowStep, {
        workflow: wf, stepNo: s.stepNo, approverUser: s.approverUser, approverRole: s.approverRole,
        approveMode: s.approveMode ?? 'SEQUENTIAL', stepName: s.stepName,
      });
    }
    await em.flush();
    return wf.id;
  }

  async function seedDoc(workflowId: string, status: DocStatus, currentStepNo: number): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `D-${seq++}`,
      company: ref(Company, ids.companyA),
      department: ref(Department, ids.deptA),
      documentType: ref(DocumentType, ids.dt),
      formTemplate: ref(FormTemplate, ids.tmpl),
      workflow: ref(Workflow, workflowId),
      currentStepNo,
      createdBy: ref(AppUser, ids.creator),
      exchangeRate: '1',
      baseTotalAmount: '10',
      status,
      submittedAt: new Date(),
      createdAt: new Date(),
    });
    await em.flush();
    // The route a real submit would have written; these documents are seeded straight into
    // IN_APPROVAL, so they never pass through start().
    if (status === DocStatus.IN_APPROVAL) await materialiseRoute(orm, doc.id, currentStepNo);
    return doc.id;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em: EntityManager = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'DA', isActive: true });
    em.create(FiscalYear, { company: companyA, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const role = em.create(Role, { company: companyA, code: 'APPROVER', name: 'Approver', isActive: true });

    const mk = (n: string) => em.create(AppUser, { username: n, email: `${n}@x`, status: 'ACTIVE' });
    const creator = mk('creator');
    const outsider = mk('outsider');
    const r1 = mk('r1');
    const r2 = mk('r2');
    const delegator = mk('delegator');
    const delegate = mk('delegate');
    const chain = mk('chain');
    for (const u of [r1, r2]) em.create(UserCompanyRole, { user: u, company: companyA, department: deptA, role, isDefault: false });

    const dt = em.create(DocumentType, { company: companyA, code: 'MEMO', name: 'Memo', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, requiresVendor: false, isActive: true });
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    await em.flush();
    Object.assign(ids, {
      companyA: companyA.id, deptA: deptA.id, role: role.id,
      creator: creator.id, outsider: outsider.id, r1: r1.id, r2: r2.id,
      delegator: delegator.id, delegate: delegate.id, chain: chain.id,
      dt: dt.id, tmpl: tmpl.id,
    });

    routing = new ApprovalRoutingService(
      orm.em,
      new ApproverResolverService(orm.em),
      null as any,
      null as any,
      new DocumentRouteService(orm.em, new WorkflowStepResolver(orm.em), new ApproverResolverService(orm.em)),
    );
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('returns the current step and its approvers to the creator', async () => {
    const wfId = await workflow([{ stepNo: 1, stepName: 'Review', approverRole: ref(Role, ids.role) }]);
    const docId = await seedDoc(wfId, DocStatus.IN_APPROVAL, 1);
    const res = await asUser(ids.creator, ids.companyA, () => routing.pendingApprovers(docId));
    expect(res.pending?.stepNo).toBe(1);
    expect(res.pending?.stepName).toBe('Review');
    expect(res.pending?.approveMode).toBe('SEQUENTIAL');
    expect(res.pending?.approvers.map((a) => a.name).sort()).toEqual(['r1', 'r2']);
  });

  it('returns the role name and all validity-dated holders for a role step', async () => {
    const wfId = await workflow([{ stepNo: 1, approverRole: ref(Role, ids.role) }]);
    const docId = await seedDoc(wfId, DocStatus.IN_APPROVAL, 1);
    const res = await asUser(ids.creator, ids.companyA, () => routing.pendingApprovers(docId));
    expect(res.pending?.roleName).toBe('Approver');
    expect(res.pending?.approvers).toHaveLength(2);
  });

  it('includes an active delegate attributed to its principal and does not chain', async () => {
    const em = orm.em.fork();
    em.create(ApprovalDelegation, { company: ref(Company, ids.companyA), delegator: ref(AppUser, ids.delegator), delegate: ref(AppUser, ids.delegate), startDate: '2000-01-01', endDate: FAR, status: 'ACTIVE', createdAt: new Date() });
    em.create(ApprovalDelegation, { company: ref(Company, ids.companyA), delegator: ref(AppUser, ids.delegate), delegate: ref(AppUser, ids.chain), startDate: '2000-01-01', endDate: FAR, status: 'ACTIVE', createdAt: new Date() });
    await em.flush();

    const wfId = await workflow([{ stepNo: 1, approverUser: ref(AppUser, ids.delegator) }]);
    const docId = await seedDoc(wfId, DocStatus.IN_APPROVAL, 1);
    const res = await asUser(ids.creator, ids.companyA, () => routing.pendingApprovers(docId));
    const names = res.pending!.approvers.map((a) => a.name);
    expect(names).toContain('delegator');
    expect(names).toContain('delegate');
    expect(names).not.toContain('chain'); // one hop only (invariant 8)
    const del = res.pending!.approvers.find((a) => a.name === 'delegate')!;
    expect(del.delegatedFrom).toBe('delegator');
  });

  it('rejects a non-participant DOC_VIEW user as not found', async () => {
    const wfId = await workflow([{ stepNo: 1, approverRole: ref(Role, ids.role) }]);
    const docId = await seedDoc(wfId, DocStatus.IN_APPROVAL, 1);
    await expect(asUser(ids.outsider, ids.companyA, () => routing.pendingApprovers(docId))).rejects.toThrow();
  });

  it('returns pending: null for a document that is not in approval', async () => {
    const wfId = await workflow([{ stepNo: 1, approverRole: ref(Role, ids.role) }]);
    const docId = await seedDoc(wfId, DocStatus.DRAFT, 0);
    const res = await asUser(ids.creator, ids.companyA, () => routing.pendingApprovers(docId));
    expect(res.pending).toBeNull();
  });
});
