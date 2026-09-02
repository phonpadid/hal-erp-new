import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { JobLevel } from '../job-level/job-level.entities';
import { DocumentType, FormTemplate, Document } from '../document/document.entities';
import { DocCategory } from '../../common/enums';
import { Workflow, WorkflowStep } from './approval.entities';
import { WorkflowStepResolver } from './workflow-step.resolver';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

// The resolver resolves the requester's rank from the job_level master and feeds it (plus the code)
// into the shared stepEngagesFor contract. This exercises the minRank integration end to end; the
// pure matching table is covered in test/step-condition.spec.ts.
describe.skipIf(!hasDb)('WorkflowStepResolver level engagement (DB-backed)', () => {
  let orm: MikroORM;
  let resolver: WorkflowStepResolver;
  const ids = { company: '', dept: '', type: '', tmpl: '', wf: '' };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    resolver = new WorkflowStepResolver(orm.em);
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const co = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const dept = em.create(Department, { company: co, deptCode: 'D', name: 'D', isActive: true });
    const type = em.create(DocumentType, { company: co, code: 'PR', name: 'PR', category: DocCategory.PROCUREMENT, requiresBudget: false, requiresQuota: false, isActive: true });
    const tmpl = em.create(FormTemplate, { documentType: type, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company: co, name: 'WF', isActive: true });
    // Ladder: STAFF(10) < MANAGER(30) < DIRECTOR(40).
    em.create(JobLevel, { company: co, code: 'STAFF', name: 'Staff', rank: 10, isActive: true });
    em.create(JobLevel, { company: co, code: 'MANAGER', name: 'Manager', rank: 30, isActive: true });
    em.create(JobLevel, { company: co, code: 'DIRECTOR', name: 'Director', rank: 40, isActive: true });
    // Steps: 1 unrestricted, 2 minRank 40 (director+), 3 explicit [MANAGER].
    em.create(WorkflowStep, { workflow: wf, stepNo: 1, approveMode: 'SEQUENTIAL' });
    em.create(WorkflowStep, { workflow: wf, stepNo: 2, approveMode: 'SEQUENTIAL', conditionJson: '{"minRank":40}' });
    em.create(WorkflowStep, { workflow: wf, stepNo: 3, approveMode: 'SEQUENTIAL', conditionJson: '{"jobLevels":["MANAGER"]}' });
    await em.flush();
    Object.assign(ids, { company: co.id, dept: dept.id, type: type.id, tmpl: tmpl.id, wf: wf.id });
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  /** Create a requester with a job level and a DRAFT document by them; return the loaded document. */
  async function docByLevel(jobLevel: string | undefined): Promise<Document> {
    const em = orm.em.fork();
    const user = em.create(AppUser, { username: `u-${jobLevel}-${Date.now()}`, email: `u${Date.now()}@x`, status: 'ACTIVE' });
    em.create(Employee, { company: em.getReference(Company, ids.company), department: em.getReference(Department, ids.dept), user, empCode: `E-${Date.now()}`, fullName: 'W', jobLevel, status: 'ACTIVE' });
    const doc = em.create(Document, {
      docNo: `D-${Date.now()}`, company: em.getReference(Company, ids.company), department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.type), formTemplate: em.getReference(FormTemplate, ids.tmpl), workflow: em.getReference(Workflow, ids.wf),
      createdBy: user, exchangeRate: '1', baseTotalAmount: '100', status: DocStatus.DRAFT, createdAt: new Date(),
    });
    await em.flush();
    return orm.em.fork().findOneOrFail(Document, { id: doc.id }, { ...FILTER_OFF, populate: ['createdBy', 'company', 'workflow'] });
  }

  const stepNos = async (jobLevel: string | undefined) =>
    (await resolver.applicableSteps(await docByLevel(jobLevel), orm.em.fork())).map((s) => s.stepNo).sort();

  it('a STAFF requester engages only the unrestricted step', async () => {
    expect(await stepNos('STAFF')).toEqual([1]); // below minRank 40, not in [MANAGER]
  });

  it('a MANAGER requester engages the unrestricted and explicit-list steps, not the rank-40 step', async () => {
    expect(await stepNos('MANAGER')).toEqual([1, 3]); // rank 30 < 40; code in [MANAGER]
  });

  it('a DIRECTOR requester engages the unrestricted and rank-40 steps, not the [MANAGER] list', async () => {
    expect(await stepNos('DIRECTOR')).toEqual([1, 2]); // rank 40 >= 40; code not in [MANAGER]
  });

  it('resolves the requester rank from the job_level master', async () => {
    const level = await resolver.requesterLevel(await docByLevel('MANAGER'), orm.em.fork());
    expect(level).toEqual({ jobLevel: 'MANAGER', rank: 30 });
  });
});
