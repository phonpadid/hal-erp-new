import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { WorkflowConfigService } from '../approval/workflow-config.service';
import { Company } from '../multi-company/multi-company.entities';
import { seedDatabase } from '../../seed/seed-data';
import { DeptDocTypeService } from './dept-doc-type.service';
import { FormTemplateService } from './form-template.service';
import { DocumentType } from './document.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('doc-config reads: templates, mappings, workflows (DB-backed)', () => {
  let orm: MikroORM;
  let templates: FormTemplateService;
  let mappings: DeptDocTypeService;
  let workflows: WorkflowConfigService;
  let companyA = '';
  let prTypeId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    templates = new FormTemplateService(orm.em);
    mappings = new DeptDocTypeService(orm.em);
    workflows = new WorkflowConfigService(orm.em);

    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: 'DEMO' }, FILTER_OFF)).id;
    prTypeId = (await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF)).id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: 'u', companyId: companyA, departmentId: '', grants: [] }, fn);

  it('lists a document type\'s form templates with field counts', async () => {
    const tmpls = (await asA(() => templates.listForType(prTypeId))).items;
    expect(tmpls.length).toBeGreaterThanOrEqual(1);
    expect(tmpls[0].version).toBe(1);
    expect(tmpls[0].fieldCount).toBeGreaterThanOrEqual(1); // seeded 'reason' field
  });

  it('lists the active company department mappings', async () => {
    const rows = (await asA(() => mappings.listForCompany())).items;
    const codes = rows.map((r) => r.documentTypeCode);
    expect(codes).toEqual(expect.arrayContaining(['PR', 'MEMO', 'LEAVE']));
    const pr = rows.find((r) => r.documentTypeCode === 'PR')!;
    expect(pr.departmentName).toBe('Procurement');
    expect(pr.workflowName).toBe('Full Approval Chain');
    expect(pr.templateVersion).toBe(1);
  });

  it('lists workflows with their steps', async () => {
    const wfs = await asA(() => workflows.listWorkflows());
    const wf = wfs.find((w) => w.name === 'Standard Approval')!;
    expect(wf).toBeTruthy();
    expect(wf.steps.length).toBeGreaterThanOrEqual(1);
    expect(wf.steps[0].stepNo).toBe(1);
    expect(wf.steps[0].approverRoleId).toBeTruthy();
  });
});
