import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { WorkflowConfigService } from './workflow-config.service';
import { Workflow, WorkflowStep } from './approval.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Currency } from '../currency/currency.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { AppUser, Role, UserCompanyRole } from '../rbac/rbac.entities';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Step configuration used to write foreign keys straight from DTO ids through `getReference`, which
 * issues no query and therefore never consults the company filter. Every case here is a write that
 * the old code accepted and the new code must refuse (invariant 1).
 */
describe.skipIf(!hasDb)('workflow-config: the company boundary on steps (DB-backed)', () => {
  let orm: MikroORM;
  let svc: WorkflowConfigService;
  let companyA = '';
  let deptId = '';
  let prTypeId = '';
  let templateId = '';
  let userId = '';
  let aRoleId = '';
  // Company B's own workflow, role, and a user who is a member of B and of nothing else.
  let bWorkflowId = '';
  let bRoleId = '';
  let bUserId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    svc = new WorkflowConfigService(orm.em);

    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    deptId = (await em.findOneOrFail(Department, { company: companyA }, FILTER_OFF)).id;
    prTypeId = (await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF)).id;
    templateId = (await em.findOneOrFail(FormTemplate, { documentType: prTypeId }, FILTER_OFF)).id;
    userId = (await em.find(AppUser, {}, { ...FILTER_OFF, limit: 1 }))[0].id;
    // A step must name an approver, so every fixture step below carries one. What each test
    // asserts is unrelated — a duplicate step number, a cross-company target, a workflow rename.
    aRoleId = (await em.findOneOrFail(Role, { company: companyA }, FILTER_OFF)).id;

    const thb = await em.findOneOrFail(Currency, { code: 'THB' }, FILTER_OFF);
    const companyB = em.create(Company, {
      code: 'OTHER', nameTh: 'Other', taxId: '9', branchCode: '00000', baseCurrency: thb, isActive: true,
    });
    const bDept = em.create(Department, { company: companyB, deptCode: 'B-OPS', name: 'B Ops', isActive: true });
    const bWorkflow = em.create(Workflow, { company: companyB, name: 'B Approval', isActive: true });
    const bRole = em.create(Role, { company: companyB, code: 'B-APPROVER', name: 'B Approver' });
    const bUser = em.create(AppUser, { username: 'b-only', email: 'b-only@example.test', passwordHash: 'x', status: 'ACTIVE' });
    em.create(UserCompanyRole, { user: bUser, company: companyB, department: bDept, role: bRole, isDefault: true });
    await em.flush();
    bWorkflowId = bWorkflow.id;
    bRoleId = bRole.id;
    bUserId = bUser.id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId, companyId: companyA, departmentId: deptId, grants: [] }, fn);

  const stepCount = (workflowId: string) =>
    orm.em.fork().count(WorkflowStep, { workflow: workflowId }, FILTER_OFF);

  async function orphanWorkflow(name: string): Promise<string> {
    const wf = await asA(() => svc.createWorkflow({ name }));
    return wf.id;
  }

  it('refuses a step added to another company\'s workflow, and writes nothing', async () => {
    const before = await stepCount(bWorkflowId);
    await expect(
      asA(() => svc.addStep({ workflowId: bWorkflowId, stepNo: 1, approveMode: 'SEQUENTIAL', approverRoleId: aRoleId })),
    ).rejects.toThrow(/not found/i);
    expect(await stepCount(bWorkflowId)).toBe(before);
  });

  it('refuses a step created with a role from another company', async () => {
    const wfId = await orphanWorkflow('Foreign Role On Create');
    await expect(
      asA(() => svc.addStep({ workflowId: wfId, stepNo: 1, approveMode: 'SEQUENTIAL', approverRoleId: bRoleId })),
    ).rejects.toThrow(/approverRoleId/);
    expect(await stepCount(wfId)).toBe(0);
  });

  it('refuses a step created with a user who is not a member of this company', async () => {
    const wfId = await orphanWorkflow('Foreign User On Create');
    await expect(
      asA(() => svc.addStep({ workflowId: wfId, stepNo: 1, approveMode: 'SEQUENTIAL', approverUserId: bUserId })),
    ).rejects.toThrow(/approverUserId/);
    expect(await stepCount(wfId)).toBe(0);
  });

  // updateStep verifies the step it edits and then assigned the approver through the same unchecked
  // reference — the half of the hole that looked safe.
  it('refuses a step UPDATED to a role from another company, leaving the step unchanged', async () => {
    const wfId = await orphanWorkflow('Foreign Role On Update');
    const step = await asA(() => svc.addStep({ workflowId: wfId, stepNo: 1, approveMode: 'SEQUENTIAL', approverRoleId: aRoleId }));
    await expect(asA(() => svc.updateStep(step.id, { approverRoleId: bRoleId }))).rejects.toThrow(/approverRoleId/);
    const after = await orm.em.fork().findOneOrFail(WorkflowStep, { id: step.id }, FILTER_OFF);
    // Still the role it was created with. Stronger than the old assertion, which checked that a
    // step with no approver still had none — true whether or not the write was rolled back.
    expect(after.approverRole?.id).toBe(aRoleId);
  });

  it('refuses a step UPDATED to a user from another company, leaving the step unchanged', async () => {
    const wfId = await orphanWorkflow('Foreign User On Update');
    const step = await asA(() => svc.addStep({ workflowId: wfId, stepNo: 1, approveMode: 'SEQUENTIAL', approverRoleId: aRoleId }));
    await expect(asA(() => svc.updateStep(step.id, { approverUserId: bUserId }))).rejects.toThrow(/approverUserId/);
    const after = await orm.em.fork().findOneOrFail(WorkflowStep, { id: step.id }, FILTER_OFF);
    expect(after.approverUser ?? null).toBeNull();
    expect(after.approverRole?.id).toBe(aRoleId);
  });

  it('refuses a step whose ESCALATION target belongs to another company', async () => {
    const wfId = await orphanWorkflow('Foreign Escalation Target');
    await expect(
      asA(() => svc.addStep({ workflowId: wfId, stepNo: 1, approveMode: 'SEQUENTIAL', approverRoleId: aRoleId, escalateToRoleId: bRoleId })),
    ).rejects.toThrow(/escalateToRoleId/);
    await expect(
      asA(() => svc.addStep({ workflowId: wfId, stepNo: 1, approveMode: 'SEQUENTIAL', approverRoleId: aRoleId, escalateToUserId: bUserId })),
    ).rejects.toThrow(/escalateToUserId/);
    expect(await stepCount(wfId)).toBe(0);
  });

  it('accepts a step whose approver role belongs to the active company', async () => {
    const wfId = await orphanWorkflow('Own Role');
    const ownRole = await orm.em.fork().findOneOrFail(Role, { company: companyA }, FILTER_OFF);
    const step = await asA(() =>
      svc.addStep({ workflowId: wfId, stepNo: 1, approveMode: 'SEQUENTIAL', approverRoleId: ownRole.id }),
    );
    const saved = await orm.em.fork().findOneOrFail(WorkflowStep, { id: step.id }, FILTER_OFF);
    expect(saved.approverRole?.id).toBe(ownRole.id);
  });

  it('allows adding a step while the workflow has an in-flight document', async () => {
    const wfId = await orphanWorkflow('Add While Routing');
    await asA(() => svc.addStep({ workflowId: wfId, stepNo: 10, approveMode: 'SEQUENTIAL', approverRoleId: aRoleId }));

    const em = orm.em.fork();
    em.create(Document, {
      docNo: `ADD-${wfId.slice(0, 8)}`,
      company: em.getReference(Company, companyA),
      department: em.getReference(Department, deptId),
      documentType: em.getReference(DocumentType, prTypeId),
      formTemplate: em.getReference(FormTemplate, templateId),
      workflow: em.getReference(Workflow, wfId),
      createdBy: em.getReference(AppUser, userId),
      status: DocStatus.IN_APPROVAL,
    });
    await em.flush();

    // The in-flight document runs the route it recorded at submit, so the new step reaches
    // documents submitted afterwards and cannot change the one already routing.
    await asA(() => svc.addStep({ workflowId: wfId, stepNo: 20, approveMode: 'SEQUENTIAL', approverRoleId: aRoleId }));
    expect(await stepCount(wfId)).toBe(2);
  });

  it('refuses a duplicate step number rather than failing on the unique index', async () => {
    const wfId = await orphanWorkflow('Duplicate Step No');
    await asA(() => svc.addStep({ workflowId: wfId, stepNo: 1, approveMode: 'SEQUENTIAL', approverRoleId: aRoleId }));
    await expect(asA(() => svc.addStep({ workflowId: wfId, stepNo: 1, approveMode: 'SEQUENTIAL', approverRoleId: aRoleId }))).rejects.toThrow(
      /already exists/i,
    );
    expect(await stepCount(wfId)).toBe(1);
  });

  it('round-trips a workflow with no selection condition of its own', async () => {
    const wfId = await orphanWorkflow('No Condition');
    await asA(() => svc.updateWorkflow(wfId, { name: 'Still No Condition' }));
    const listed = (await asA(() => svc.listWorkflows())).find((w) => w.id === wfId);
    expect(listed).toBeDefined();
    expect(Object.keys(listed!)).toEqual(['id', 'name', 'isActive', 'steps']);
  });
});
