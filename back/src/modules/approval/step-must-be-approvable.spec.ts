import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser, Role } from '../rbac/rbac.entities';
import { Workflow, WorkflowStep } from './approval.entities';
import { WorkflowConfigService } from './workflow-config.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * A step naming no approver resolves to an empty principal list — and nothing downstream objects.
 * It still matches on its amount band and the requester's level, routing opens it, `openStep`
 * writes zero actors, and the document reaches `IN_APPROVAL` in nobody's queue holding whatever it
 * reserved at submit. No error, no notification: indistinguishable from a document merely waiting.
 *
 * `Approver by Role or Person` has said "either a company role or a specific user" since it was
 * written. Nothing enforced it.
 */
describe.skipIf(!hasDb)('a step must name an approver (DB-backed)', () => {
  let orm: MikroORM;
  let svc: WorkflowConfigService;
  let companyId = '';
  let roleId = '';

  const asCompany = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: 'u', companyId, departmentId: 'd', grants: [] }, fn);

  async function orphanWorkflow(name: string, isActive = true): Promise<string> {
    const em = orm.em.fork();
    const wf = em.create(Workflow, {
      company: em.getReference(Company, companyId), name, isActive,
    } as never);
    await em.flush();
    return wf.id;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    svc = new WorkflowConfigService(orm.em);
    const em = orm.em.fork();
    companyId = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    roleId = (await em.findOneOrFail(Role, { company: companyId }, FILTER_OFF)).id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('refuses a new step that names neither a role nor a user', async () => {
    const wfId = await orphanWorkflow('No Approver On Create');
    await expect(
      asCompany(() => svc.addStep({ workflowId: wfId, stepNo: 1, approveMode: 'SEQUENTIAL' } as never)),
    ).rejects.toThrow(BadRequestException);
  });

  it('names the step in the refusal', async () => {
    // An administrator editing a long workflow needs to know which row to fix, not which service
    // complained.
    const wfId = await orphanWorkflow('Named Refusal');
    await expect(
      asCompany(() => svc.addStep({ workflowId: wfId, stepNo: 7, approveMode: 'SEQUENTIAL' } as never)),
    ).rejects.toThrow(/Step 7/);
  });

  it('accepts a role that nobody currently holds', async () => {
    // The case the rule must NOT catch. Who holds a role is a staffing fact, true only today, and
    // answered by adding somebody to the role — not by editing the workflow.
    const em = orm.em.fork();
    const empty = em.create(Role, {
      company: em.getReference(Company, companyId), code: 'VACANT', name: 'Vacant', isActive: true,
    } as never);
    await em.flush();

    const wfId = await orphanWorkflow('Vacant Role');
    const step = await asCompany(() =>
      svc.addStep({ workflowId: wfId, stepNo: 1, approveMode: 'SEQUENTIAL', approverRoleId: empty.id } as never),
    );
    expect(step.approverRole?.id).toBe(empty.id);
  });

  it('accepts a step naming a specific person instead of a role', async () => {
    const em = orm.em.fork();
    const anyUser = (await em.find(AppUser, {}, { ...FILTER_OFF, limit: 1 }))[0];
    const wfId = await orphanWorkflow('Named Person');
    const step = await asCompany(() =>
      svc.addStep({ workflowId: wfId, stepNo: 1, approveMode: 'SEQUENTIAL', approverUserId: anyUser.id } as never),
    );
    expect(step.approverUser?.id).toBe(anyUser.id);
  });

  it('refuses CLEARING the only approver on an existing step', async () => {
    // The both-directions case. A check shaped around the dto sees only the field that moved and
    // would let this through — the discipline `assertNoOtherVoucherType` states two modules away.
    const wfId = await orphanWorkflow('Cleared Approver');
    const step = await asCompany(() =>
      svc.addStep({ workflowId: wfId, stepNo: 1, approveMode: 'SEQUENTIAL', approverRoleId: roleId } as never),
    );

    await expect(
      asCompany(() => svc.updateStep(step.id, { approverRoleId: null } as never)),
    ).rejects.toThrow(/names no approver/i);

    // Rolled back: the step still names who it named.
    const after = await orm.em.fork().findOneOrFail(WorkflowStep, { id: step.id }, FILTER_OFF);
    expect(after.approverRole?.id).toBe(roleId);
  });

  it('allows swapping one approver for another', async () => {
    // Clearing the role while naming a user in the same write leaves the step approvable, so it
    // must be accepted — the rule is about the resulting state, not about which field moved.
    const em = orm.em.fork();
    const anyUser = (await em.find(AppUser, {}, { ...FILTER_OFF, limit: 1 }))[0];
    const wfId = await orphanWorkflow('Swap Approver');
    const step = await asCompany(() =>
      svc.addStep({ workflowId: wfId, stepNo: 1, approveMode: 'SEQUENTIAL', approverRoleId: roleId } as never),
    );

    await asCompany(() =>
      svc.updateStep(step.id, { approverRoleId: null, approverUserId: anyUser.id } as never),
    );
    const after = await orm.em.fork().findOneOrFail(WorkflowStep, { id: step.id }, FILTER_OFF);
    expect(after.approverUser?.id).toBe(anyUser.id);
  });

  it('leaves an inactive workflow alone', async () => {
    // An inactive workflow routes nothing, so an incomplete step in it harms no document. The rule
    // binds when the workflow is active, as the neighbouring voucher rule binds on isActive.
    const wfId = await orphanWorkflow('Draft Workflow', false);
    const step = await asCompany(() =>
      svc.addStep({ workflowId: wfId, stepNo: 1, approveMode: 'SEQUENTIAL' } as never),
    );
    expect(step.approverRole ?? null).toBeNull();
  });
});
