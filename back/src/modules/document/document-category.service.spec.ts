import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company } from '../multi-company/multi-company.entities';
import { DocumentCategoryService } from './document-category.service';
import { DocumentTypeService } from './document-type.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

function asCompany<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId: 'u', companyId, departmentId: 'd', grants: [] }, fn);
}

describe.skipIf(!hasDb)('DocumentCategoryService (DB-backed)', () => {
  let orm: MikroORM;
  let categories: DocumentCategoryService;
  let types: DocumentTypeService;
  const ids = { companyA: '', companyB: '' };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const a = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const b = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true });
    await em.flush();
    Object.assign(ids, { companyA: a.id, companyB: b.id });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    categories = new DocumentCategoryService(orm.em.fork());
    types = new DocumentTypeService(orm.em.fork());
  });

  it('creates a category scoped to the active company and lists only that company', async () => {
    const created = await asCompany(ids.companyA, () => categories.create({ code: 'LEGAL', name: 'Legal' }));
    expect(created.company.id).toBe(ids.companyA);

    const listA = await asCompany(ids.companyA, () => categories.list({}));
    expect(listA.items.some((c) => c.code === 'LEGAL')).toBe(true);
    const listB = await asCompany(ids.companyB, () => categories.list({}));
    expect(listB.items.some((c) => c.code === 'LEGAL')).toBe(false);
  });

  it('allows the same code in two companies but rejects a duplicate in one', async () => {
    await asCompany(ids.companyA, () => categories.create({ code: 'MKT', name: 'Marketing' }));
    // Same code in company B is fine (uniqueness is per company).
    await expect(asCompany(ids.companyB, () => categories.create({ code: 'MKT', name: 'B Marketing' }))).resolves.toBeDefined();
    // A duplicate within company A is a 409.
    await expect(asCompany(ids.companyA, () => categories.create({ code: 'MKT', name: 'dup' }))).rejects.toThrow(ConflictException);
  });

  it('updates name/active state but treats code as immutable, and scopes get to the company', async () => {
    const cat = await asCompany(ids.companyA, () => categories.create({ code: 'OPS', name: 'Ops' }));
    const updated = await asCompany(ids.companyA, () => categories.update(cat.id, { name: 'Operations', isActive: false }));
    expect(updated.name).toBe('Operations');
    expect(updated.isActive).toBe(false);
    expect(updated.code).toBe('OPS'); // unchanged — the update DTO carries no code
    // A category of another company is not found.
    await expect(asCompany(ids.companyB, () => categories.get(cat.id))).rejects.toThrow(NotFoundException);
  });

  it('blocks hard-delete while a document type references the category, but allows it otherwise', async () => {
    const cat = await asCompany(ids.companyA, () => categories.create({ code: 'FAC', name: 'Facilities' }));
    // Unreferenced → delete succeeds.
    const spare = await asCompany(ids.companyA, () => categories.create({ code: 'SPARE', name: 'Spare' }));
    await expect(asCompany(ids.companyA, () => categories.remove(spare.id))).resolves.toBeUndefined();

    // Referenced by a document type → delete rejected (deactivate instead).
    await asCompany(ids.companyA, () => types.create({ code: 'FACREQ', name: 'Facility Request', category: 'FAC' }));
    await expect(asCompany(ids.companyA, () => categories.remove(cat.id))).rejects.toThrow(BadRequestException);
  });

  it('rejects a document type that references an inactive category', async () => {
    await asCompany(ids.companyA, () => categories.create({ code: 'ARCHIVED', name: 'Archived' }));
    // Deactivate it, then a new type using its code must be rejected (only active categories count).
    const list = await asCompany(ids.companyA, () => categories.list({}, true));
    const archived = list.items.find((c) => c.code === 'ARCHIVED')!;
    await asCompany(ids.companyA, () => categories.update(archived.id, { name: 'Archived', isActive: false }));
    await expect(
      asCompany(ids.companyA, () => types.create({ code: 'ARCH_DOC', name: 'Arch', category: 'ARCHIVED' })),
    ).rejects.toThrow(/not an active category/i);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[document-category] no database reachable — skipping DB-backed spec');
}
