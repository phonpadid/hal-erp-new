import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { BudgetService } from '../budget/budget.service';
import { ItemService } from '../master-data/item.service';
import { Company, Department } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { ScopeService } from '../rbac/scope.service';
import {seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentService } from './document.service';
import { DocumentType } from './document.entities';
import { NumberingService } from './numbering.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('document-engine: requester-facing creation reads (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  let companyId = '';
  let deptId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    const em = orm.em.fork();
    companyId = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    deptId = (await em.findOneOrFail(Department, { company: companyId, deptCode: 'PROC' }, FILTER_OFF)).id;

    const scope = new CompanyScopeService(orm.em);
    documents = new DocumentService(
      orm.em,
      scope,
      new DeptDocTypeService(orm.em),
      new NumberingService(orm.em),
      new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope)),
      new BudgetService(orm.em, new AccountService(orm.em, scope)),
      new FiscalYearService(scope),
    );
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const asDept = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: 'u', companyId, departmentId: deptId, grants: [] }, fn);

  it('lists the department\'s creatable types with their flags', async () => {
    const types = await asDept(() => documents.listCreatableTypes());
    const codes = types.map((t) => t.code);
    expect(codes).toEqual(expect.arrayContaining(['PR', 'MEMO', 'LEAVE']));
    expect(types.find((t) => t.code === 'PR')!.requiresBudget).toBe(true);
    expect(types.find((t) => t.code === 'LEAVE')!.requiresQuota).toBe(true);
  });

  it('returns a type\'s form fields for rendering', async () => {
    const pr = await orm.em.fork().findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const form = await asDept(() => documents.formForType(pr.id));
    expect(form.fields.some((f) => f.fieldName === 'reason' && f.isRequired)).toBe(true);
  });

  it('rejects a type not mapped to the active department', async () => {
    const em = orm.em.fork();
    const orphan = em.create(DocumentType, { company: em.getReference(Company, companyId), code: 'ORPHAN', name: 'Orphan', category: 'ADMIN' as any, isActive: true });
    await em.flush();
    await expect(asDept(() => documents.formForType(orphan.id))).rejects.toThrow();
  });
});
