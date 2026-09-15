import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../../auth/auth.service';
import { StorageService } from '../../common/storage/storage.service';
import { Scope } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company, Department } from '../multi-company/multi-company.entities';
import { MembershipService } from './membership.service';
import { PasswordService } from './password.service';
import { PermissionResolverService } from './permission-resolver.service';
import {
  AppUser,
  Permission,
  Role,
  RolePermission,
  UserCompanyRole,
} from './rbac.entities';
import { RoleAdminService } from './role-admin.service';
import { RbacAuthService } from './rbac-auth.service';
import type { JwtPayload } from '../../auth/jwt-payload.interface';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const PAST = '2000-01-01';

describe.skipIf(!hasDb)('rbac services (DB-backed)', () => {
  let orm: MikroORM;
  let jwt: JwtService;
  let passwords: PasswordService;
  let resolver: PermissionResolverService;
  let memberships: MembershipService;
  let auth: RbacAuthService;
  let admin: RoleAdminService;

  // Captured seed ids.
  const ids = {
    companyA: '',
    companyB: '',
    companyC: '',
    deptA: '',
    deptA2: '',
    deptB: '',
    userDefault: '',
    userNoDefault: '',
    inactiveUser: '',
    unverifiedUser: '',
    resolveUser: '',
  };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '1h' } });
    passwords = new PasswordService();
    resolver = new PermissionResolverService(orm.em);
    memberships = new MembershipService(orm.em);
    admin = new RoleAdminService(orm.em, resolver);
    auth = new RbacAuthService(orm.em, passwords, resolver, memberships, new AuthService(jwt), new StorageService());

    const em = orm.em.fork();
    const hash = await passwords.hash('secret');

    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const companyB = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true });
    const companyC = em.create(Company, { code: 'C', nameTh: 'C', taxId: '3', branchCode: '00000', isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'DA', isActive: true });
    // Two more departments of A: one the resolveUser's second role sits in, one only an expired role sits in.
    const deptA2 = em.create(Department, { company: companyA, deptCode: 'DA2', name: 'DA2', isActive: true });
    const deptA3 = em.create(Department, { company: companyA, deptCode: 'DA3', name: 'DA3', isActive: true });
    const deptB = em.create(Department, { company: companyB, deptCode: 'DB', name: 'DB', isActive: true });

    // Permissions
    const docView = em.create(Permission, { code: 'DOC_VIEW', name: 'View', module: 'DOCUMENT', isActive: true });
    const docEdit = em.create(Permission, { code: 'DOC_EDIT', name: 'Edit', module: 'DOCUMENT', isActive: true });
    const deadPerm = em.create(Permission, { code: 'DEAD', name: 'Dead', module: 'DOCUMENT', isActive: false });

    // Roles
    const roleA = em.create(Role, { company: companyA, code: 'RA', name: 'RA', isActive: true });
    const roleB = em.create(Role, { company: companyB, code: 'RB', name: 'RB', isActive: true });
    em.create(RolePermission, { role: roleA, permission: docView, scope: Scope.COMPANY });
    em.create(RolePermission, { role: roleB, permission: docView, scope: Scope.DEPARTMENT });

    // Users. Verified email (email_verified_at) is required to log in; set it on accounts that
    // are expected to authenticate. `unverifiedUser` deliberately leaves it null to test the gate.
    const now = new Date();
    const userDefault = em.create(AppUser, { username: 'def', email: 'def@x', passwordHash: hash, status: 'ACTIVE', emailVerifiedAt: now });
    const userNoDefault = em.create(AppUser, { username: 'nodef', email: 'nodef@x', passwordHash: hash, status: 'ACTIVE', emailVerifiedAt: now });
    const inactiveUser = em.create(AppUser, { username: 'inact', email: 'inact@x', passwordHash: hash, status: 'RESIGNED', emailVerifiedAt: now });
    const unverifiedUser = em.create(AppUser, { username: 'unverif', email: 'unverif@x', passwordHash: hash, status: 'ACTIVE' });
    em.create(UserCompanyRole, { user: unverifiedUser, company: companyA, department: deptA, role: roleA, isDefault: true });

    // userDefault: A (default) + B
    em.create(UserCompanyRole, { user: userDefault, company: companyA, department: deptA, role: roleA, isDefault: true });
    em.create(UserCompanyRole, { user: userDefault, company: companyB, department: deptB, role: roleB, isDefault: false });
    // userNoDefault: A + B, neither default
    em.create(UserCompanyRole, { user: userNoDefault, company: companyA, department: deptA, role: roleA, isDefault: false });
    em.create(UserCompanyRole, { user: userNoDefault, company: companyB, department: deptB, role: roleB, isDefault: false });

    // resolveUser: two roles in A granting DOC_VIEW at DEPARTMENT and COMPANY,
    // plus DOC_EDIT@OWN and inactive DEAD@COMPANY; and an expired role in A. The three
    // assignments sit in three departments so the resolved department SET can be checked too.
    const resolveUser = em.create(AppUser, { username: 'res', email: 'res@x', passwordHash: hash, status: 'ACTIVE', emailVerifiedAt: now });
    const roleDept = em.create(Role, { company: companyA, code: 'RDEP', name: 'RDEP', isActive: true });
    const roleComp = em.create(Role, { company: companyA, code: 'RCOMP', name: 'RCOMP', isActive: true });
    const roleExpired = em.create(Role, { company: companyA, code: 'REXP', name: 'REXP', isActive: true });
    em.create(RolePermission, { role: roleDept, permission: docView, scope: Scope.DEPARTMENT });
    em.create(RolePermission, { role: roleComp, permission: docView, scope: Scope.COMPANY });
    em.create(RolePermission, { role: roleComp, permission: docEdit, scope: Scope.OWN });
    em.create(RolePermission, { role: roleComp, permission: deadPerm, scope: Scope.COMPANY });
    em.create(RolePermission, { role: roleExpired, permission: docEdit, scope: Scope.COMPANY });
    em.create(UserCompanyRole, { user: resolveUser, company: companyA, department: deptA, role: roleDept, isDefault: true });
    em.create(UserCompanyRole, { user: resolveUser, company: companyA, department: deptA2, role: roleComp, isDefault: false });
    em.create(UserCompanyRole, { user: resolveUser, company: companyA, department: deptA3, role: roleExpired, isDefault: false, validTo: PAST });

    await em.flush();

    ids.companyA = companyA.id;
    ids.companyB = companyB.id;
    ids.companyC = companyC.id;
    ids.deptA = deptA.id;
    ids.deptA2 = deptA2.id;
    ids.deptB = deptB.id;
    ids.userDefault = userDefault.id;
    ids.userNoDefault = userNoDefault.id;
    ids.inactiveUser = inactiveUser.id;
    ids.unverifiedUser = unverifiedUser.id;
    ids.resolveUser = resolveUser.id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const decode = (token: string) => jwt.verify<JwtPayload>(token);

  // ---- 7.1 Credentials --------------------------------------------------------

  it('authenticates an active user with the correct password', async () => {
    const res = await auth.login('def', 'secret');
    expect(res.accessToken).toBeTruthy();
  });

  it('rejects a wrong password', async () => {
    await expect(auth.login('def', 'nope')).rejects.toThrow();
  });

  it('rejects a non-ACTIVE account even with the correct password', async () => {
    await expect(auth.login('inact', 'secret')).rejects.toThrow();
  });

  it('denies an unverified email with a distinct EMAIL_NOT_VERIFIED outcome, then allows after verify', async () => {
    // Correct password + ACTIVE, but email not verified → distinct denial, no token.
    await expect(auth.login('unverif', 'secret')).rejects.toThrow('EMAIL_NOT_VERIFIED');

    // Mark the email verified (admin path), then login succeeds.
    const em = orm.em.fork();
    const u = await em.findOneOrFail(AppUser, { id: ids.unverifiedUser });
    u.emailVerifiedAt = new Date();
    await em.flush();

    const res = await auth.login('unverif', 'secret');
    expect(res.accessToken).toBeTruthy();
  });

  // ---- 7.2 Login / company selection -----------------------------------------

  it('issues a token for the default company and lists all accessible companies', async () => {
    const res = await auth.login('def', 'secret');
    expect(res.companies).toHaveLength(2);
    expect(res.accessToken).toBeTruthy();
    expect(decode(res.accessToken!).companyId).toBe(ids.companyA);
  });

  it('lists companies but issues no token when there is no default', async () => {
    const res = await auth.login('nodef', 'secret');
    expect(res.companies).toHaveLength(2);
    expect(res.accessToken).toBeNull();
  });

  it('switches to a member company and re-issues a scoped token', async () => {
    const res = await auth.switchCompany(ids.userDefault, ids.companyB);
    const payload = decode(res.accessToken);
    expect(payload.companyId).toBe(ids.companyB);
    expect(payload.departmentId).toBe(ids.deptB);
    expect(payload.grants).toContainEqual({ code: 'DOC_VIEW', scope: Scope.DEPARTMENT });
  });

  it('rejects switching to a company the user has no membership in', async () => {
    await expect(auth.switchCompany(ids.userDefault, ids.companyC)).rejects.toThrow();
  });

  // ---- 7.3 Resolution ---------------------------------------------------------

  it('unions roles, keeps broadest scope, drops inactive and expired', async () => {
    const r = await resolver.resolve(ids.resolveUser, ids.companyA);
    expect(r).not.toBeNull();
    const grants = r!.grants;
    // DOC_VIEW granted at DEPARTMENT and COMPANY → COMPANY wins, once.
    expect(grants.filter((g) => g.code === 'DOC_VIEW')).toEqual([
      { code: 'DOC_VIEW', scope: Scope.COMPANY },
    ]);
    // DOC_EDIT@OWN from the active role is present...
    expect(grants).toContainEqual({ code: 'DOC_EDIT', scope: Scope.OWN });
    // ...the expired role's DOC_EDIT@COMPANY did NOT widen it.
    expect(grants.find((g) => g.code === 'DOC_EDIT')!.scope).toBe(Scope.OWN);
    // Inactive permission excluded.
    expect(grants.find((g) => g.code === 'DEAD')).toBeUndefined();
  });

  it('resolves the home department from the default assignment and the SET from every active one', async () => {
    const r = (await resolver.resolve(ids.resolveUser, ids.companyA))!;
    // Home = the is_default assignment's department, and it leads the set.
    expect(r.departmentId).toBe(ids.deptA);
    expect(r.departmentIds[0]).toBe(ids.deptA);
    // The second role's department is in the set; the expired role's is not — the same validity
    // window that dropped its codes drops its department.
    expect([...r.departmentIds].sort()).toEqual([ids.deptA, ids.deptA2].sort());
  });

  it('a single assignment resolves to a set of one, and another company adds nothing', async () => {
    // userDefault: deptA in A (default), deptB in B. Resolving A must not see B's department.
    const r = (await resolver.resolve(ids.userDefault, ids.companyA))!;
    expect(r.departmentId).toBe(ids.deptA);
    expect(r.departmentIds).toEqual([ids.deptA]);
  });

  it('stamps both the home department and the set on the issued token', async () => {
    const { accessToken } = await auth.switchCompany(ids.resolveUser, ids.companyA);
    const payload = jwt.verify<JwtPayload>(accessToken);
    expect(payload.departmentId).toBe(ids.deptA);
    expect([...(payload.departmentIds ?? [])].sort()).toEqual([ids.deptA, ids.deptA2].sort());
  });

  // ---- 7.5 Resignation --------------------------------------------------------

  it('revokes one company only, leaving other memberships intact', async () => {
    const expired = await admin.revokeCompanyAccess(ids.userNoDefault, ids.companyA);
    expect(expired).toBeGreaterThan(0);

    expect(await resolver.resolve(ids.userNoDefault, ids.companyA)).toBeNull();
    expect(await resolver.resolve(ids.userNoDefault, ids.companyB)).not.toBeNull();
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[rbac] no database reachable — skipping DB-backed spec');
}
