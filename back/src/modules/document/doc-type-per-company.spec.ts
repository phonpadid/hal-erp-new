import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { DocCategory } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentTypeService } from './document-type.service';
import { DocumentType, FormTemplate } from './document.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

function asCompany<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId: 'u', companyId, departmentId: 'd', grants: [] }, fn);
}

describe.skipIf(!hasDb)('document_type per company (DB-backed)', () => {
  let orm: MikroORM;
  let types: DocumentTypeService;
  let deptTypes: DeptDocTypeService;
  const ids = { companyA: '', companyB: '', deptA: '', typeB: '', tmplB: '', wfB: '' };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const a = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const b = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true });
    const deptA = em.create(Department, { company: a, deptCode: 'DA', name: 'DA', isActive: true });
    // A type owned by company B (+ its form template and a workflow), for the cross-company guard.
    const typeB = em.create(DocumentType, { company: b, code: 'PR', name: 'PR-B', category: DocCategory.PROCUREMENT, isActive: true });
    const tmplB = em.create(FormTemplate, { documentType: typeB, version: 1, status: 'PUBLISHED' });
    const wfB = em.create(Workflow, { company: b, name: 'WFB', isActive: true });
    await em.flush();
    Object.assign(ids, {
      companyA: a.id, companyB: b.id, deptA: deptA.id, typeB: typeB.id, tmplB: tmplB.id, wfB: wfB.id,
    });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    types = new DocumentTypeService(orm.em.fork());
    deptTypes = new DeptDocTypeService(orm.em.fork());
  });

  it('stamps the active company on create and scopes list/get to it', async () => {
    const created = await asCompany(ids.companyA, () =>
      types.create({ code: 'EXP', name: 'Expense', category: DocCategory.FINANCE }),
    );
    expect(created.company.id).toBe(ids.companyA);

    // Company A lists only its own type; company B's `PR` is not visible.
    const listA = await asCompany(ids.companyA, () => types.list({}));
    expect(listA.items.some((t) => t.id === created.id)).toBe(true);
    expect(listA.items.some((t) => t.id === ids.typeB)).toBe(false);
  });

  it('resolves a cross-company type as not found', async () => {
    await expect(asCompany(ids.companyA, () => types.get(ids.typeB))).rejects.toThrow(NotFoundException);
  });

  it('allows the same code in two companies', async () => {
    // Company B already owns `PR`; company A creating `PR` succeeds (uniqueness is per company).
    const prA = await asCompany(ids.companyA, () =>
      types.create({ code: 'PR', name: 'PR-A', category: DocCategory.PROCUREMENT }),
    );
    expect(prA.company.id).toBe(ids.companyA);
    expect(prA.code).toBe('PR');
  });

  it('rejects a second type with the same code in the same company', async () => {
    await asCompany(ids.companyB, () =>
      expect(types.create({ code: 'PR', name: 'dup', category: DocCategory.PROCUREMENT })).rejects.toThrow(/already exists/i),
    );
  });

  it('rejects mapping a department to a document type of another company', async () => {
    // Department in company A, type owned by company B → cross-company mapping rejected.
    await expect(
      asCompany(ids.companyA, () =>
        deptTypes.create({
          departmentId: ids.deptA,
          documentTypeId: ids.typeB,
          formTemplateId: ids.tmplB,
          workflowId: ids.wfB,
        }),
      ),
    ).rejects.toThrow(/different companies/i);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[doc-type-per-company] no database reachable — skipping DB-backed spec');
}
