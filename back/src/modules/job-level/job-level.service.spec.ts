import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { Workflow, WorkflowStep } from '../approval/approval.entities';
import { JobLevel } from './job-level.entities';
import { JobLevelService } from './job-level.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('JobLevelService CRUD (DB-backed)', () => {
  let orm: MikroORM;
  let svc: JobLevelService;
  let companyA = '';
  let companyB = '';
  let deptA = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    svc = new JobLevelService(orm.em, new CompanyScopeService(orm.em));
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const a = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const b = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const d = em.create(Department, { company: a, deptCode: 'DA', name: 'DA', isActive: true });
    await em.flush();
    companyA = a.id; companyB = b.id; deptA = d.id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const asA = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId: companyA, grants: [] }, fn);
  const asB = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId: companyB, grants: [] }, fn);

  it('enforces per-company code uniqueness and isolation', async () => {
    await asA(() => svc.create({ code: 'MANAGER', name: 'Manager', rank: 30 }));
    await expect(asA(() => svc.create({ code: 'MANAGER', name: 'dup', rank: 31 }))).rejects.toThrow(/already exists/);
    // Same code in another company is allowed, and A cannot see B's levels.
    await asB(() => svc.create({ code: 'MANAGER', name: 'B Manager', rank: 30 }));
    const listA = await asA(() => svc.list({ limit: 100 }, true));
    expect(listA.items.every((l) => l.company.id === companyA)).toBe(true);
    expect(listA.items).toHaveLength(1);
  });

  it('lists ordered by rank and excludes inactive from selectable', async () => {
    await asA(() => svc.create({ code: 'STAFF', name: 'Staff', rank: 10 }));
    await asA(() => svc.create({ code: 'EXEC', name: 'Executive', rank: 50, isActive: false }));
    const listed = await asA(() => svc.list({ limit: 100 }, true));
    expect(listed.items.map((l) => l.code)).toEqual(['STAFF', 'MANAGER', 'EXEC']); // rank 10,30,50
    const selectable = await asA(() => svc.listSelectable());
    expect(selectable.map((l) => l.code)).toEqual(['STAFF', 'MANAGER']); // inactive EXEC excluded
  });

  it('resolveActiveByCode returns rank for active, null for inactive/unknown', async () => {
    expect(await svc.resolveActiveByCode('MANAGER', companyA, orm.em.fork())).toEqual({ code: 'MANAGER', rank: 30 });
    expect(await svc.resolveActiveByCode('EXEC', companyA, orm.em.fork())).toBeNull(); // inactive
    expect(await svc.resolveActiveByCode('NOPE', companyA, orm.em.fork())).toBeNull(); // unknown
    expect(await svc.resolveActiveByCode('MANAGER', companyB, orm.em.fork())).toEqual({ code: 'MANAGER', rank: 30 });
  });

  it('deactivate keeps the row resolvable for existing references but drops it from selectable', async () => {
    const created = await asA(() => svc.create({ code: 'TEMP', name: 'Temp', rank: 60 }));
    await asA(() => svc.deactivate(created.id));
    const selectable = await asA(() => svc.listSelectable());
    expect(selectable.some((l) => l.code === 'TEMP')).toBe(false);
    // Still present in the admin (includeInactive) list.
    const all = await asA(() => svc.list({ limit: 100 }, true));
    expect(all.items.some((l) => l.code === 'TEMP')).toBe(true);
  });

  it('rejects hard-delete of a level referenced by an employee', async () => {
    const level = await asA(() => svc.create({ code: 'INUSE_EMP', name: 'In use', rank: 70 }));
    const em = orm.em.fork();
    em.create(Employee, { company: em.getReference(Company, companyA), department: em.getReference(Department, deptA), empCode: `E-${Date.now()}`, fullName: 'W', jobLevel: 'INUSE_EMP', status: 'ACTIVE' });
    await em.flush();
    await expect(asA(() => svc.remove(level.id))).rejects.toThrow(/in use/);
  });

  it('rejects hard-delete of a level referenced by a workflow step condition', async () => {
    const level = await asA(() => svc.create({ code: 'INUSE_STEP', name: 'In use step', rank: 80 }));
    const em = orm.em.fork();
    const wf = em.create(Workflow, { company: em.getReference(Company, companyA), name: 'WF', isActive: true });
    em.create(WorkflowStep, { workflow: wf, stepNo: 1, approveMode: 'SEQUENTIAL', conditionJson: '{"jobLevels":["INUSE_STEP"]}' });
    await em.flush();
    await expect(asA(() => svc.remove(level.id))).rejects.toThrow(/in use/);
  });

  it('hard-deletes an unreferenced level', async () => {
    const level = await asA(() => svc.create({ code: 'ORPHAN', name: 'Orphan', rank: 90 }));
    await asA(() => svc.remove(level.id));
    const gone = await orm.em.fork().findOne(JobLevel, { code: 'ORPHAN', company: companyA }, FILTER_OFF);
    expect(gone).toBeNull();
  });
});
