import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { WorkflowConfigService } from './workflow-config.service';
import { Workflow, WorkflowStep } from './approval.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { AppUser, Role } from '../rbac/rbac.entities';
import {seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('workflow-config mutations (DB-backed)', () => {
  let orm: MikroORM;
  let svc: WorkflowConfigService;
  let companyA = '';
  let deptId = '';
  let prTypeId = '';
  let templateId = '';
  let userId = '';
  let aRoleId = '';

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
    // find(..limit:1) rather than findOneOrFail({}) — this MikroORM version rejects an empty where.
    userId = (await em.find(AppUser, {}, { ...FILTER_OFF, limit: 1 }))[0].id;
    // A step must name an approver, so every fixture step below carries one. What each test
    // asserts is unrelated — a duplicate step number, a cross-company target, a workflow rename.
    aRoleId = (await em.findOneOrFail(Role, { company: companyA }, FILTER_OFF)).id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId, companyId: companyA, departmentId: deptId, grants: [] }, fn);

  // A fresh orphan workflow (no mapping, no documents) plus one step, for edit/delete tests.
  async function makeOrphan(name: string): Promise<{ wfId: string; stepId: string }> {
    const wf = await asA(() => svc.createWorkflow({ name }));
    const step = await asA(() =>
      svc.addStep({ workflowId: wf.id, stepNo: 1, approveMode: 'SEQUENTIAL', approverRoleId: aRoleId, amountMin: '0', amountMax: '1000' }),
    );
    return { wfId: wf.id, stepId: step.id };
  }

  async function attachInFlightDoc(workflowId: string): Promise<void> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `IF-${workflowId.slice(0, 8)}`,
      company: em.getReference(Company, companyA),
      department: em.getReference(Department, deptId),
      documentType: em.getReference(DocumentType, prTypeId),
      formTemplate: em.getReference(FormTemplate, templateId),
      workflow: em.getReference(Workflow, workflowId),
      createdBy: em.getReference(AppUser, userId),
      status: DocStatus.SUBMITTED,
    });
    await em.persistAndFlush(doc);
  }

  it('updates a workflow name and active state', async () => {
    const { wfId } = await makeOrphan('Edit Me');
    await asA(() => svc.updateWorkflow(wfId, { name: 'Renamed', isActive: false }));
    const wf = await orm.em.fork().findOneOrFail(Workflow, { id: wfId }, FILTER_OFF);
    expect(wf.name).toBe('Renamed');
    expect(wf.isActive).toBe(false);
  });

  it('rejects deleting a workflow used by a department mapping', async () => {
    const wfId = (await orm.em.fork().findOneOrFail(Workflow, { name: 'Standard Approval' }, FILTER_OFF)).id;
    await expect(asA(() => svc.deleteWorkflow(wfId))).rejects.toThrow(/mapping/i);
  });

  it('rejects deleting a workflow referenced by a document', async () => {
    const { wfId } = await makeOrphan('Has Doc');
    await attachInFlightDoc(wfId);
    await expect(asA(() => svc.deleteWorkflow(wfId))).rejects.toThrow(/document/i);
  });

  it('deletes an orphan workflow together with its steps', async () => {
    const { wfId, stepId } = await makeOrphan('Orphan');
    await asA(() => svc.deleteWorkflow(wfId));
    const em = orm.em.fork();
    expect(await em.findOne(Workflow, { id: wfId }, FILTER_OFF)).toBeNull();
    expect(await em.findOne(WorkflowStep, { id: stepId }, FILTER_OFF)).toBeNull();
  });

  it('edits a step when no document is in-flight', async () => {
    const { stepId } = await makeOrphan('Step Edit');
    await asA(() => svc.updateStep(stepId, { amountMax: '5000', slaHours: 48 }));
    const step = await orm.em.fork().findOneOrFail(WorkflowStep, { id: stepId }, FILTER_OFF);
    expect(step.amountMax).toBe('5000.00');
    expect(step.slaHours).toBe(48);
  });

  it('rejects an inverted amount range on step edit', async () => {
    const { stepId } = await makeOrphan('Bad Range');
    await expect(asA(() => svc.updateStep(stepId, { amountMin: '9000', amountMax: '100' }))).rejects.toThrow(/amountMin/i);
  });

  it('defaults show_signature_on_pdf to true and lets an admin toggle it off', async () => {
    const { stepId } = await makeOrphan('Sig Toggle');
    // Default on create.
    let step = await orm.em.fork().findOneOrFail(WorkflowStep, { id: stepId }, FILTER_OFF);
    expect(step.showSignatureOnPdf).toBe(true);
    // Toggle off through the step-config mutation.
    await asA(() => svc.updateStep(stepId, { showSignatureOnPdf: false }));
    step = await orm.em.fork().findOneOrFail(WorkflowStep, { id: stepId }, FILTER_OFF);
    expect(step.showSignatureOnPdf).toBe(false);
    // Surfaced by the read projection for the config UI.
    const listed = (await asA(() => svc.listWorkflows())).flatMap((w) => w.steps).find((s) => s.id === stepId);
    expect(listed?.showSignatureOnPdf).toBe(false);
  });

  // The inverse of the rule this file used to assert. Routing reads the route each document
  // recorded at submit, so configuration is no longer frozen while anything is in flight — and a
  // company whose documents are always in flight can maintain its workflows again.
  it('allows editing and deleting a step while a document is in-flight', async () => {
    const { wfId, stepId } = await makeOrphan('Editable While Routing');
    await attachInFlightDoc(wfId);
    await asA(() => svc.updateStep(stepId, { slaHours: 12 }));
    expect((await orm.em.fork().findOneOrFail(WorkflowStep, { id: stepId }, FILTER_OFF)).slaHours).toBe(12);
    await asA(() => svc.deleteStep(stepId));
    expect(await orm.em.fork().findOne(WorkflowStep, { id: stepId }, FILTER_OFF)).toBeNull();
  });

  it('deletes a step when no document is in-flight', async () => {
    const { stepId } = await makeOrphan('Step Delete');
    await asA(() => svc.deleteStep(stepId));
    expect(await orm.em.fork().findOne(WorkflowStep, { id: stepId }, FILTER_OFF)).toBeNull();
  });

  it('defaults requires_payment_slip to false and lets an admin turn it on', async () => {
    // False on create: every step demanded nothing before this setting existed, and a step nobody
    // has configured must keep demanding nothing.
    const { stepId } = await makeOrphan('Slip Requirement');
    let step = await orm.em.fork().findOneOrFail(WorkflowStep, { id: stepId }, FILTER_OFF);
    expect(step.requiresPaymentSlip).toBe(false);

    await asA(() => svc.updateStep(stepId, { requiresPaymentSlip: true }));
    step = await orm.em.fork().findOneOrFail(WorkflowStep, { id: stepId }, FILTER_OFF);
    expect(step.requiresPaymentSlip).toBe(true);

    // Surfaced by the read projection, so the config screen can show what was authored.
    const listed = (await asA(() => svc.listWorkflows())).flatMap((w) => w.steps).find((s) => s.id === stepId);
    expect(listed?.requiresPaymentSlip).toBe(true);
  });

  it('can turn the slip requirement on while a document is in-flight', async () => {
    // Permitted like every other step edit. It reaches documents submitted afterwards and cannot
    // reach one already routing, because routing runs the route recorded at submit.
    const { wfId, stepId } = await makeOrphan('Slip While Routing');
    await attachInFlightDoc(wfId);
    await asA(() => svc.updateStep(stepId, { requiresPaymentSlip: true }));
    expect(
      (await orm.em.fork().findOneOrFail(WorkflowStep, { id: stepId }, FILTER_OFF)).requiresPaymentSlip,
    ).toBe(true);
  });
});
