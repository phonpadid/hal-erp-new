import { changePasswordSchema } from '@erp/shared';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Scope } from '../../common/enums';
import { dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company, Department } from '../multi-company/multi-company.entities';
import { PasswordService } from './password.service';
import { PermissionResolverService } from './permission-resolver.service';
import { ProfileService } from './profile.service';
import { AppUser, Employee, Permission, Role, RolePermission, UserCompanyRole } from './rbac.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

// DTO-boundary rules (the ZodValidationPipe enforces these before the service runs).
describe('changePasswordSchema (shared DTO rules)', () => {
  it('rejects a new password that violates the strength policy', () => {
    const r = changePasswordSchema.safeParse({ currentPassword: 'OldPass123', newPassword: 'short' });
    expect(r.success).toBe(false);
  });

  it('rejects a new password equal to the current one', () => {
    const r = changePasswordSchema.safeParse({ currentPassword: 'SamePass123', newPassword: 'SamePass123' });
    expect(r.success).toBe(false);
  });

  it('accepts a policy-compliant new password that differs from the current', () => {
    const r = changePasswordSchema.safeParse({ currentPassword: 'OldPass123', newPassword: 'NewPass456' });
    expect(r.success).toBe(true);
  });
});

describe.skipIf(!hasDb)('ProfileService (DB-backed)', () => {
  let orm: MikroORM;
  let service: ProfileService;
  const passwords = new PasswordService();

  /** Seed a company + department and return them for wiring employees. */
  async function seedOrg(code: string): Promise<{ company: Company; department: Department }> {
    const em = orm.em.fork();
    const company = em.create(Company, { code, nameTh: code, taxId: code, branchCode: '00000', isActive: true });
    const department = em.create(Department, { company, deptCode: `D${code}`, name: `Dept ${code}`, isActive: true });
    await em.persistAndFlush([company, department]);
    return { company, department };
  }

  async function seedUser(username: string, plain = 'OldPass123'): Promise<AppUser> {
    const em = orm.em.fork();
    const user = em.create(AppUser, {
      username,
      email: `${username}@example.com`,
      passwordHash: await passwords.hash(plain),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    });
    await em.persistAndFlush(user);
    return user;
  }

  async function linkEmployee(
    user: AppUser,
    company: Company,
    department: Department,
    over: Partial<Employee> = {},
  ): Promise<Employee> {
    const em = orm.em.fork();
    const emp = em.create(Employee, {
      company,
      department,
      user,
      empCode: over.empCode ?? `E-${company.code}`,
      fullName: over.fullName ?? 'Alice Example',
      position: over.position ?? 'Analyst',
      status: 'ACTIVE',
    });
    await em.persistAndFlush(emp);
    return emp;
  }

  beforeAll(async () => {
    orm = await initTestOrm();
    await orm.schema.refreshDatabase();
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  /** Grant `user` a role named `roleName` in `company`/`department`, with the given permission grants. */
  async function grantRole(
    user: AppUser,
    company: Company,
    department: Department,
    roleName: string,
    grants: { code: string; scope: Scope }[],
    isDefault = true,
  ): Promise<void> {
    const em = orm.em.fork();
    const role = em.create(Role, { company, code: roleName, name: roleName, isActive: true });
    for (const g of grants) {
      let permission = await em.findOne(Permission, { code: g.code });
      if (!permission) {
        permission = em.create(Permission, { code: g.code, name: g.code, module: 'TEST', isActive: true });
      }
      em.create(RolePermission, { role, permission, scope: g.scope });
    }
    em.create(UserCompanyRole, { user, company, department, role, isDefault });
    await em.flush();
  }

  beforeEach(async () => {
    await orm.em.fork().nativeDelete(UserCompanyRole, {});
    await orm.em.fork().nativeDelete(RolePermission, {});
    await orm.em.fork().nativeDelete(Employee, {});
    await orm.em.fork().nativeDelete(AppUser, {});
    await orm.em.fork().nativeDelete(Role, {});
    await orm.em.fork().nativeDelete(Department, {});
    await orm.em.fork().nativeDelete(Company, {});
    await orm.em.fork().nativeDelete(Permission, {});
    service = new ProfileService(orm.em, passwords, new PermissionResolverService(orm.em));
  });

  describe('getProfile', () => {
    it('returns identity fields and never exposes password_hash', async () => {
      const user = await seedUser('idfields');

      const profile = await service.getProfile(user.id, null);

      expect(profile.username).toBe('idfields');
      expect(profile.email).toBe('idfields@example.com');
      expect(profile.status).toBe('ACTIVE');
      expect(profile.emailVerifiedAt).toBeInstanceOf(Date);
      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile).not.toHaveProperty('password_hash');
      expect(JSON.stringify(profile)).not.toContain('$2'); // no bcrypt hash leaked
    });

    it('includes the linked employee for the active company', async () => {
      const { company, department } = await seedOrg('A');
      const user = await seedUser('withemp');
      await linkEmployee(user, company, department, { fullName: 'Bob Builder', position: 'Manager' });

      const profile = await service.getProfile(user.id, company.id);

      expect(profile.employee).toEqual({
        fullName: 'Bob Builder',
        position: 'Manager',
        departmentName: 'Dept A',
      });
    });

    it('omits employee fields when no employee links the user', async () => {
      const { company } = await seedOrg('A');
      const user = await seedUser('noemp');

      const profile = await service.getProfile(user.id, company.id);

      expect(profile.employee).toBeNull();
    });

    it('resolves the employee only within the active company', async () => {
      const a = await seedOrg('A');
      const b = await seedOrg('B');
      const user = await seedUser('multi');
      await linkEmployee(user, a.company, a.department, { empCode: 'E-A', fullName: 'In A' });
      await linkEmployee(user, b.company, b.department, { empCode: 'E-B', fullName: 'In B' });

      const profileA = await service.getProfile(user.id, a.company.id);
      expect(profileA.employee?.fullName).toBe('In A');
      expect(profileA.employee?.departmentName).toBe('Dept A');
    });

    it('rejects an unknown user (token names a deleted account)', async () => {
      await expect(service.getProfile('00000000-0000-0000-0000-000000000000', null)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('includes the held role and resolved permissions for a single-role user', async () => {
      const { company, department } = await seedOrg('A');
      const user = await seedUser('singlerole');
      await grantRole(user, company, department, 'Approver', [{ code: 'DOC_APPROVE', scope: Scope.DEPARTMENT }]);

      const profile = await service.getProfile(user.id, company.id);

      expect(profile.roles).toEqual(['Approver']);
      expect(profile.permissions).toEqual([{ code: 'DOC_APPROVE', scope: Scope.DEPARTMENT }]);
    });

    it('unions permissions (broadest scope wins) across every role held in the company', async () => {
      const { company, department } = await seedOrg('A');
      const user = await seedUser('multirole');
      await grantRole(user, company, department, 'Requester', [{ code: 'DOC_VIEW', scope: Scope.DEPARTMENT }]);
      await grantRole(
        user,
        company,
        department,
        'Reviewer',
        [{ code: 'DOC_VIEW', scope: Scope.COMPANY }, { code: 'DOC_APPROVE', scope: Scope.OWN }],
        false,
      );

      const profile = await service.getProfile(user.id, company.id);
      const direct = await new PermissionResolverService(orm.em).resolve(user.id, company.id);

      expect(profile.roles.sort()).toEqual(['Requester', 'Reviewer']);
      expect(profile.permissions).toContainEqual({ code: 'DOC_VIEW', scope: Scope.COMPANY });
      expect(profile.permissions).toContainEqual({ code: 'DOC_APPROVE', scope: Scope.OWN });
      expect(profile.permissions.sort((a, b) => a.code.localeCompare(b.code))).toEqual(
        direct!.grants.sort((a, b) => a.code.localeCompare(b.code)),
      );
    });

    it('scopes roles and permissions to the active company only', async () => {
      const a = await seedOrg('A');
      const b = await seedOrg('B');
      const user = await seedUser('crosscompany');
      await grantRole(user, a.company, a.department, 'RoleInA', [{ code: 'DOC_VIEW', scope: Scope.COMPANY }]);
      await grantRole(user, b.company, b.department, 'RoleInB', [{ code: 'BUDGET_VIEW', scope: Scope.COMPANY }]);

      const profileA = await service.getProfile(user.id, a.company.id);

      expect(profileA.roles).toEqual(['RoleInA']);
      expect(profileA.permissions).toEqual([{ code: 'DOC_VIEW', scope: Scope.COMPANY }]);
    });
  });

  describe('changePassword', () => {
    it('changes the password when the current password is correct', async () => {
      const user = await seedUser('changer', 'OldPass123');

      await service.changePassword(user.id, 'OldPass123', 'NewPass456');

      const reloaded = await orm.em.fork().findOneOrFail(AppUser, { id: user.id });
      expect(await passwords.verify('NewPass456', reloaded.passwordHash!)).toBe(true);
      expect(await passwords.verify('OldPass123', reloaded.passwordHash!)).toBe(false);
    });

    it('rejects a wrong current password and leaves the hash unchanged', async () => {
      const user = await seedUser('wrongcur', 'OldPass123');
      const before = (await orm.em.fork().findOneOrFail(AppUser, { id: user.id })).passwordHash;

      await expect(service.changePassword(user.id, 'NotMyPass9', 'NewPass456')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      const after = (await orm.em.fork().findOneOrFail(AppUser, { id: user.id })).passwordHash;
      expect(after).toBe(before);
    });

    it('rejects a new password equal to the current one (service defense in depth)', async () => {
      const user = await seedUser('samepass', 'SamePass123');

      await expect(service.changePassword(user.id, 'SamePass123', 'SamePass123')).rejects.toBeInstanceOf(
        BadRequestException,
      );

      const reloaded = await orm.em.fork().findOneOrFail(AppUser, { id: user.id });
      expect(await passwords.verify('SamePass123', reloaded.passwordHash!)).toBe(true);
    });
  });
});
