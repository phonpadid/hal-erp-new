import { BadRequestException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { DocCategory } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company } from '../multi-company/multi-company.entities';
import { Permission } from '../rbac/rbac.entities';
import { DocumentTypeService } from './document-type.service';
import { DocumentCategory, DocumentType } from './document.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

function asCompany<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId: 'u', companyId, departmentId: 'd', grants: [] }, fn);
}

/**
 * `document_type.view_permission_code` — the read gate a type may carry — as CONFIGURATION: what
 * may be stored, and what the administrator's form may choose from. What the gate does to reads is
 * covered in document-visibility.spec.ts.
 */
describe.skipIf(!hasDb)('document-type view gate (DB-backed)', () => {
  let orm: MikroORM;
  let types: DocumentTypeService;
  const ids = { companyA: '', legacy: '' };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const a = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    em.create(DocumentCategory, { company: a, code: DocCategory.ADMIN, name: 'Admin', isActive: true });
    em.create(Permission, { code: 'BUDGET_VIEW', name: 'View budgets', module: 'BUDGET', isActive: true });
    em.create(Permission, { code: 'DEAD_CODE', name: 'Retired', module: 'BUDGET', isActive: false });
    em.create(Permission, { code: 'DOC_VIEW', name: 'View documents', module: 'DOCUMENT', isActive: true });
    // A type from before the gate existed: the column is simply absent.
    const legacy = em.create(DocumentType, { company: a, code: 'MEMO', name: 'Memo', category: DocCategory.ADMIN, isActive: true });
    await em.flush();
    ids.companyA = a.id;
    ids.legacy = legacy.id;
    types = new DocumentTypeService(orm.em.fork());
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  it('an existing type has no gate', async () => {
    const t = await asCompany(ids.companyA, () => types.get(ids.legacy));
    // Loaded from the column it is null; freshly cleared in memory it is undefined. Both are "no gate".
    expect(t.viewPermissionCode ?? undefined).toBeUndefined();
  });

  it('a gate must name an active permission code, on create and on update', async () => {
    await expect(
      asCompany(ids.companyA, () => types.create({ code: 'X1', name: 'x', category: DocCategory.ADMIN, viewPermissionCode: 'NOT_A_CODE' })),
    ).rejects.toThrow(/NOT_A_CODE/);
    await expect(
      asCompany(ids.companyA, () => types.create({ code: 'X2', name: 'x', category: DocCategory.ADMIN, viewPermissionCode: 'DEAD_CODE' })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      asCompany(ids.companyA, () => types.update(ids.legacy, { viewPermissionCode: 'NOT_A_CODE' })),
    ).rejects.toThrow(/NOT_A_CODE/);
    // A refused create leaves nothing behind.
    expect(await orm.em.fork().findOne(DocumentType, { code: 'X1' }, { filters: { company: false } })).toBeNull();
  });

  it('a valid gate is stored, and an empty one is stored as null', async () => {
    const created = await asCompany(ids.companyA, () =>
      types.create({ code: 'PLAN', name: 'Budget plan', category: DocCategory.ADMIN, viewPermissionCode: 'BUDGET_VIEW' }),
    );
    expect(created.viewPermissionCode).toBe('BUDGET_VIEW');

    const cleared = await asCompany(ids.companyA, () => types.update(created.id, { viewPermissionCode: '' }));
    expect(cleared.viewPermissionCode ?? undefined).toBeUndefined();

    const regated = await asCompany(ids.companyA, () => types.update(created.id, { viewPermissionCode: ' BUDGET_VIEW ' }));
    expect(regated.viewPermissionCode).toBe('BUDGET_VIEW');

    const nulled = await asCompany(ids.companyA, () => types.update(created.id, { viewPermissionCode: null }));
    expect(nulled.viewPermissionCode ?? undefined).toBeUndefined();
  });

  it('lists the active catalog codes for the form, and nothing more', async () => {
    const codes = await types.listPermissionCodes();
    expect(codes).toContainEqual({ code: 'BUDGET_VIEW', name: 'View budgets', module: 'BUDGET' });
    expect(codes.map((c) => c.code)).not.toContain('DEAD_CODE');
    for (const c of codes) expect(Object.keys(c).sort()).toEqual(['code', 'module', 'name']);
  });
});
