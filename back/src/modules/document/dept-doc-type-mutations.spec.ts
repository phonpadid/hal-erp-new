import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company } from '../multi-company/multi-company.entities';
import { Workflow } from '../approval/approval.entities';
import {seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentType, FormTemplate } from './document.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('dept-doc-type mutations: update + duplicate conflict (DB-backed)', () => {
  let orm: MikroORM;
  let mappings: DeptDocTypeService;
  let companyA = '';
  let prMappingId = '';
  let prTemplateId = '';
  let procDeptId = '';
  let prTypeId = '';
  let standardWfId = '';
  let fullChainWfId = '';
  let memoTemplateId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    mappings = new DeptDocTypeService(orm.em);

    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    prTypeId = (await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF)).id;
    standardWfId = (await em.findOneOrFail(Workflow, { name: 'Standard Approval' }, FILTER_OFF)).id;
    fullChainWfId = (await em.findOneOrFail(Workflow, { name: 'Full Approval Chain' }, FILTER_OFF)).id;
    const memoType = await em.findOneOrFail(DocumentType, { code: 'MEMO' }, FILTER_OFF);
    memoTemplateId = (await em.findOneOrFail(FormTemplate, { documentType: memoType.id }, FILTER_OFF)).id;

    const rows = (await asA(() => mappings.listForCompany())).items;
    const pr = rows.find((r) => r.documentTypeCode === 'PR')!;
    prMappingId = pr.id;
    prTemplateId = pr.formTemplateId;
    procDeptId = pr.departmentId;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  function asA<T>(fn: () => Promise<T>): Promise<T> {
    return RequestContext.run({ userId: 'u', companyId: companyA, departmentId: '', grants: [] }, fn);
  }

  it('repoints a mapping to a different workflow (future documents resolve the new one)', async () => {
    await asA(() => mappings.update(prMappingId, { workflowId: standardWfId }));
    // resolve() is what document creation reads — it now returns the new workflow.
    const resolved = await asA(() => mappings.resolve(procDeptId, prTypeId));
    expect(resolved.workflow.id).toBe(standardWfId);

    // Restore so the rest of the suite / seed baseline is unaffected.
    await asA(() => mappings.update(prMappingId, { workflowId: fullChainWfId }));
    expect((await asA(() => mappings.resolve(procDeptId, prTypeId))).workflow.id).toBe(fullChainWfId);
  });

  it('rejects a duplicate (department, document type) mapping with a conflict', async () => {
    await expect(
      asA(() =>
        mappings.create({
          departmentId: procDeptId,
          documentTypeId: prTypeId,
          formTemplateId: prTemplateId,
          workflowId: standardWfId,
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an update whose template belongs to another document type, leaving the row unchanged', async () => {
    await expect(
      asA(() => mappings.update(prMappingId, { formTemplateId: memoTemplateId })),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Unchanged: still the PR template.
    const resolved = await asA(() => mappings.resolve(procDeptId, prTypeId));
    expect(resolved.formTemplate.id).toBe(prTemplateId);
  });

  it('does not find a mapping that belongs to another company', async () => {
    const otherCompany = '00000000-0000-0000-0000-000000000000';
    await expect(
      RequestContext.run({ userId: 'u', companyId: otherCompany, departmentId: '', grants: [] }, () =>
        mappings.update(prMappingId, { workflowId: standardWfId }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
