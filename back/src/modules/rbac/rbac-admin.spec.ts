import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { Scope } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { seedDatabase } from '../../seed/seed-data';
import { PermissionResolverService } from './permission-resolver.service';
import { RoleAdminService } from './role-admin.service';
import { AppUser, Role, RolePermission, UserCompanyRole } from './rbac.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('rbac admin reads + fine-grained removes (DB-backed)', () => {
  let orm: MikroORM;
  let admin: RoleAdminService;
  let companyA = '';
  let otherUcrId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    admin = new RoleAdminService(orm.em, new PermissionResolverService(orm.em));
    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: 'DEMO' }, FILTER_OFF)).id;

    // An assignment in a SECOND company — must never surface for company A.
    const thb = await em.findOneOrFail(Currency, { code: 'THB' }, FILTER_OFF);
    const compB = em.create(Company, { code: 'DEMO2', nameTh: 'บีโค', nameEn: 'B Co', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const deptB = em.create(Department, { company: compB, deptCode: 'PROC', name: 'Proc B', isActive: true });
    const roleB = em.create(Role, { company: compB, code: 'ADMIN', name: 'Admin B', isActive: true });
    const adminUser = await em.findOneOrFail(AppUser, { username: 'admin' }, FILTER_OFF);
    const ucrB = em.create(UserCompanyRole, { user: adminUser, company: compB, department: deptB, role: roleB, isDefault: false });
    await em.flush();
    otherUcrId = ucrB.id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: 'u', companyId: companyA, departmentId: '', grants: [] }, fn);

  it('lists the company roles with their grants', async () => {
    const { items: roles } = await asA(() => admin.listRoles());
    const codes = roles.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['ADMIN', 'APPROVER', 'REQUESTER']));
    const approver = roles.find((r) => r.code === 'APPROVER')!;
    expect(approver.permissions.map((p) => p.code)).toContain('DOC_APPROVE');
  });

  it('lists the permission catalog', async () => {
    const { items: perms } = await asA(() => admin.listPermissions({ limit: 100 }));
    expect(perms.map((p) => p.code)).toContain('RBAC_MANAGE');
  });

  it('lists users with only active-company assignments', async () => {
    const { items: users } = await asA(() => admin.listUsers());
    const adminU = users.find((u) => u.username === 'admin')!;
    expect(adminU.assignments.length).toBe(1); // company A only, not company B
    expect(adminU.assignments[0].roleCode).toBe('ADMIN');
  });

  it('detaches a single grant', async () => {
    const { items: roles } = await asA(() => admin.listRoles());
    const approverId = roles.find((r) => r.code === 'APPROVER')!.id;
    await asA(() => admin.detachPermission(approverId, 'BUDGET_VIEW'));
    const { items: after } = await asA(() => admin.listRoles());
    const approver = after.find((r) => r.code === 'APPROVER')!;
    expect(approver.permissions.map((p) => p.code)).not.toContain('BUDGET_VIEW');
    expect(approver.permissions.map((p) => p.code)).toContain('DOC_APPROVE'); // others intact
  });

  it('removes a single assignment and rejects a cross-company one', async () => {
    const { items: users } = await asA(() => admin.listUsers());
    const reqAssign = users.find((u) => u.username === 'requester')!.assignments[0];
    await asA(() => admin.removeAssignment(reqAssign.id));
    const { items: after } = await asA(() => admin.listUsers());
    expect(after.find((u) => u.username === 'requester')!.assignments).toHaveLength(0);

    await expect(asA(() => admin.removeAssignment(otherUcrId))).rejects.toThrow();
  });
});
