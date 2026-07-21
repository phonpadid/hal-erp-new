import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { Scope } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { PermissionResolverService } from './permission-resolver.service';
import { RoleAdminService } from './role-admin.service';
import { AppUser, Role, RolePermission, UserCompanyRole } from './rbac.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('rbac bulk grant + assign (DB-backed)', () => {
  let orm: MikroORM;
  let admin: RoleAdminService;
  let companyA = '';
  let deptA = '';
  let roleB = '';
  let deptB = '';
  let requesterId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    admin = new RoleAdminService(orm.em, new PermissionResolverService(orm.em));
    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    deptA = (await em.findOneOrFail(Department, { company: companyA, deptCode: 'PROC' }, FILTER_OFF)).id;
    requesterId = (await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF)).id;

    // A SECOND company whose role and department must never be reachable from company A.
    const thb = await em.findOneOrFail(Currency, { code: 'THB' }, FILTER_OFF);
    const compB = em.create(Company, {
      code: 'DEMO2', nameTh: 'บีโค', nameEn: 'B Co', taxId: '1',
      branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date(),
    });
    const dB = em.create(Department, { company: compB, deptCode: 'PROC', name: 'Proc B', isActive: true });
    const rB = em.create(Role, { company: compB, code: 'ADMIN', name: 'Admin B', isActive: true });
    await em.flush();
    roleB = rB.id;
    deptB = dB.id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: 'u', companyId: companyA, departmentId: '', grants: [] }, fn);

  /** A fresh role per test, so one test's grants can't colour another's. */
  async function newRole(code: string): Promise<string> {
    const role = await asA(() => admin.createRole({ code, name: code }));
    return role.id;
  }

  async function grantsOf(roleId: string): Promise<Array<{ code: string; scope: string }>> {
    const em = orm.em.fork();
    const rows = await em.find(RolePermission, { role: roleId }, { ...FILTER_OFF, populate: ['permission'] });
    return rows.map((r) => ({ code: r.permission.code, scope: r.scope })).sort((a, b) => a.code.localeCompare(b.code));
  }

  it('grants many permissions in one batch', async () => {
    const roleId = await newRole('BULK_1');
    const res = await asA(() =>
      admin.attachPermissionsBulk(
        roleId,
        [
          { permissionCode: 'DOC_APPROVE', scope: Scope.DEPARTMENT },
          { permissionCode: 'BUDGET_VIEW', scope: Scope.COMPANY },
        ],
        [],
      ),
    );
    expect(res.applied).toEqual(expect.arrayContaining(['DOC_APPROVE', 'BUDGET_VIEW']));
    expect(res.skipped).toHaveLength(0);
    expect(await grantsOf(roleId)).toEqual([
      { code: 'BUDGET_VIEW', scope: Scope.COMPANY },
      { code: 'DOC_APPROVE', scope: Scope.DEPARTMENT },
    ]);
  });

  it('applies grants and detaches in the same batch, leaving untouched grants alone', async () => {
    const roleId = await newRole('BULK_2');
    await asA(() =>
      admin.attachPermissionsBulk(
        roleId,
        [
          { permissionCode: 'DOC_APPROVE', scope: Scope.DEPARTMENT },
          { permissionCode: 'BUDGET_VIEW', scope: Scope.DEPARTMENT },
        ],
        [],
      ),
    );
    await asA(() =>
      admin.attachPermissionsBulk(roleId, [{ permissionCode: 'RBAC_MANAGE', scope: Scope.COMPANY }], ['DOC_APPROVE']),
    );
    expect((await grantsOf(roleId)).map((g) => g.code)).toEqual(['BUDGET_VIEW', 'RBAC_MANAGE']);
  });

  it('skips a re-grant at the same scope and updates one at a new scope in place', async () => {
    const roleId = await newRole('BULK_3');
    await asA(() =>
      admin.attachPermissionsBulk(roleId, [{ permissionCode: 'BUDGET_VIEW', scope: Scope.DEPARTMENT }], []),
    );

    const same = await asA(() =>
      admin.attachPermissionsBulk(roleId, [{ permissionCode: 'BUDGET_VIEW', scope: Scope.DEPARTMENT }], []),
    );
    expect(same.applied).toHaveLength(0);
    expect(same.skipped).toEqual([{ item: 'BUDGET_VIEW', reason: 'ALREADY_HELD_SAME_SCOPE' }]);

    const rescoped = await asA(() =>
      admin.attachPermissionsBulk(roleId, [{ permissionCode: 'BUDGET_VIEW', scope: Scope.COMPANY }], []),
    );
    expect(rescoped.applied).toEqual(['BUDGET_VIEW']);
    // (role_id, permission_id) is unique — the scope changed in place, no second row.
    expect(await grantsOf(roleId)).toEqual([{ code: 'BUDGET_VIEW', scope: Scope.COMPANY }]);
  });

  it('reports a detach of a code the role does not hold as skipped', async () => {
    const roleId = await newRole('BULK_4');
    const res = await asA(() => admin.attachPermissionsBulk(roleId, [], ['BUDGET_VIEW']));
    expect(res.applied).toHaveLength(0);
    expect(res.skipped).toEqual([{ item: 'BUDGET_VIEW', reason: 'NOT_HELD' }]);
  });

  it('rejects the whole batch when one permission code is unknown', async () => {
    const roleId = await newRole('BULK_5');
    await expect(
      asA(() =>
        admin.attachPermissionsBulk(
          roleId,
          [
            { permissionCode: 'BUDGET_VIEW', scope: Scope.DEPARTMENT },
            { permissionCode: 'NOT_A_REAL_CODE', scope: Scope.DEPARTMENT },
          ],
          [],
        ),
      ),
    ).rejects.toThrow();
    // Atomic: the valid item did not slip through.
    expect(await grantsOf(roleId)).toHaveLength(0);
  });

  it('rejects a batch naming another company’s role and writes nothing', async () => {
    await expect(
      asA(() => admin.attachPermissionsBulk(roleB, [{ permissionCode: 'BUDGET_VIEW', scope: Scope.DEPARTMENT }], [])),
    ).rejects.toThrow();
    expect(await grantsOf(roleB)).toHaveLength(0);
  });

  // ---- Bulk assign ---------------------------------------------------------

  async function assignmentsOf(userId: string): Promise<UserCompanyRole[]> {
    return orm.em.fork().find(UserCompanyRole, { user: userId, company: companyA }, FILTER_OFF);
  }

  it('assigns several roles sharing one department and window, skipping already-held roles', async () => {
    const em = orm.em.fork();
    const approver = await em.findOneOrFail(Role, { company: companyA, code: 'APPROVER' }, FILTER_OFF);
    const requesterRole = await em.findOneOrFail(Role, { company: companyA, code: 'REQUESTER' }, FILTER_OFF);
    const adminRole = await em.findOneOrFail(Role, { company: companyA, code: 'ADMIN' }, FILTER_OFF);

    const res = await asA(() =>
      admin.assignUserRolesBulk({
        userId: requesterId,
        departmentId: deptA,
        // The seeded requester already holds REQUESTER in company A.
        roleIds: [requesterRole.id, approver.id, adminRole.id],
        validFrom: '2026-01-01',
        validTo: '2026-03-31',
      }),
    );

    expect(res.applied).toEqual(expect.arrayContaining(['APPROVER', 'ADMIN']));
    expect(res.skipped).toEqual([{ item: 'REQUESTER', reason: 'ALREADY_HELD' }]);

    const rows = await assignmentsOf(requesterId);
    const created = rows.filter((r) => r.validTo === '2026-03-31');
    expect(created).toHaveLength(2);
    for (const r of created) {
      expect(r.department.id).toBe(deptA);
      expect(r.validFrom).toBe('2026-01-01');
    }
  });

  it('lands the shared default flag on exactly one created assignment', async () => {
    const em = orm.em.fork();
    const user = await em.findOneOrFail(AppUser, { username: 'approver' }, FILTER_OFF).catch(async () =>
      em.findOneOrFail(AppUser, { username: 'admin' }, FILTER_OFF),
    );
    const roles = await em.find(Role, { company: companyA }, FILTER_OFF);
    const held = new Set((await assignmentsOf(user.id)).map((a) => a.role.id));
    const fresh = roles.filter((r) => !held.has(r.id)).slice(0, 3);
    if (fresh.length < 2) return; // nothing to prove on this seed

    await asA(() =>
      admin.assignUserRolesBulk({
        userId: user.id,
        departmentId: deptA,
        roleIds: fresh.map((r) => r.id),
        isDefault: true,
      }),
    );

    const created = (await assignmentsOf(user.id)).filter((a) => fresh.some((r) => r.id === a.role.id));
    expect(created).toHaveLength(fresh.length);
    expect(created.filter((a) => a.isDefault)).toHaveLength(1);
  });

  it('rejects a batch naming another company’s department and writes nothing', async () => {
    const em = orm.em.fork();
    const approver = await em.findOneOrFail(Role, { company: companyA, code: 'APPROVER' }, FILTER_OFF);
    const before = (await assignmentsOf(requesterId)).length;
    await expect(
      asA(() => admin.assignUserRolesBulk({ userId: requesterId, departmentId: deptB, roleIds: [approver.id] })),
    ).rejects.toThrow();
    expect((await assignmentsOf(requesterId)).length).toBe(before);
  });

  it('rejects a batch naming another company’s role and writes nothing', async () => {
    const before = (await assignmentsOf(requesterId)).length;
    await expect(
      asA(() => admin.assignUserRolesBulk({ userId: requesterId, departmentId: deptA, roleIds: [roleB] })),
    ).rejects.toThrow();
    expect((await assignmentsOf(requesterId)).length).toBe(before);
  });

  it('rejects a batch whose validity window ends before it starts', async () => {
    const em = orm.em.fork();
    const approver = await em.findOneOrFail(Role, { company: companyA, code: 'APPROVER' }, FILTER_OFF);
    const before = (await assignmentsOf(requesterId)).length;
    await expect(
      asA(() =>
        admin.assignUserRolesBulk({
          userId: requesterId,
          departmentId: deptA,
          roleIds: [approver.id],
          validFrom: '2026-06-01',
          validTo: '2026-05-01',
        }),
      ),
    ).rejects.toThrow();
    expect((await assignmentsOf(requesterId)).length).toBe(before);
  });

  // ---- The single-item routes keep their strict contract -------------------

  it('still rejects a duplicate single-item grant with a conflict', async () => {
    const roleId = await newRole('BULK_6');
    await asA(() => admin.attachPermission(roleId, 'BUDGET_VIEW', Scope.DEPARTMENT));
    await expect(asA(() => admin.attachPermission(roleId, 'BUDGET_VIEW', Scope.DEPARTMENT))).rejects.toThrow();
  });

  it('rejects a single-item assign naming another company’s role', async () => {
    await expect(
      asA(() => admin.assignUserRole({ userId: requesterId, departmentId: deptA, roleId: roleB })),
    ).rejects.toThrow();
  });
});
