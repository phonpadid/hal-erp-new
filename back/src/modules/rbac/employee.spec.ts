import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { Scope } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company, Department } from '../multi-company/multi-company.entities';
import { EmailTransport } from '../notification/transports/transport';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { JobLevelService } from '../job-level/job-level.service';
import { EmailVerificationService } from './email-verification.service';
import { EmployeeService } from './employee.service';
import { MembershipService } from './membership.service';
import { PasswordService } from './password.service';
import { PermissionResolverService } from './permission-resolver.service';
import { RoleAdminService } from './role-admin.service';
import { createHash, randomBytes } from 'node:crypto';
import {
  AppUser,
  EmailVerificationToken,
  Employee,
  Permission,
  Role,
  RolePermission,
  UserCompanyRole,
} from './rbac.entities';
import type { Grant } from '../../auth/jwt-payload.interface';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;
const PAST = '2000-01-01';

describe.skipIf(!hasDb)('employee registry + cross-company read (DB-backed)', () => {
  let orm: MikroORM;
  let employees: EmployeeService;
  let admin: RoleAdminService;
  let emailVerification: EmailVerificationService;
  const passwords = new PasswordService();

  const ids = {
    companyA: '',
    companyB: '',
    companyC: '',
    deptA: '',
    deptB: '',
    requester: '', // admins A and B (RBAC_MANAGE), not C
    target: '', // assignments in A, B, C
    linkUser: '', // linked to an employee
    roleA: '', // a role in company A (for onboarding)
    roleB: '', // a role in company B (to prove cross-company role rejection)
  };

  // Run a service call as a given company/user with explicit grants.
  const asCtx = <T>(
    companyId: string,
    fn: () => Promise<T>,
    opts: { userId?: string; grants?: Grant[] } = {},
  ) =>
    RequestContext.run(
      { userId: opts.userId ?? ids.requester, companyId, departmentId: '', grants: opts.grants ?? [] },
      fn,
    );

  const SALARY_GRANT: Grant[] = [{ code: 'EMP_SALARY_VIEW', scope: Scope.COMPANY }];

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    // EmailTransport is a no-op when MAIL_USER is unset (test), so verification sends never fail.
    emailVerification = new EmailVerificationService(orm.em, new EmailTransport());
    employees = new EmployeeService(orm.em, passwords, emailVerification, new JobLevelService(orm.em, new CompanyScopeService(orm.em)));
    admin = new RoleAdminService(orm.em, new PermissionResolverService(orm.em));

    const em = orm.em.fork();
    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const companyB = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true });
    const companyC = em.create(Company, { code: 'C', nameTh: 'C', taxId: '3', branchCode: '00000', isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'DA', isActive: true });
    const deptB = em.create(Department, { company: companyB, deptCode: 'DB', name: 'DB', isActive: true });
    const deptC = em.create(Department, { company: companyC, deptCode: 'DC', name: 'DC', isActive: true });

    const rbacManage = em.create(Permission, { code: 'RBAC_MANAGE', name: 'RBAC', module: 'RBAC', isActive: true });

    // Requester admins A and B (roles carry RBAC_MANAGE), but holds no role in C.
    const adminRoleA = em.create(Role, { company: companyA, code: 'ADM', name: 'Admin A', isActive: true });
    // A second company-A role used only for the EXPIRED membership below — a distinct role so it
    // doesn't collide with adminRoleA on the user_company_role (user, company, role) unique.
    const staleRoleA = em.create(Role, { company: companyA, code: 'ADM_OLD', name: 'Admin A (old)', isActive: true });
    const adminRoleB = em.create(Role, { company: companyB, code: 'ADM', name: 'Admin B', isActive: true });
    const plainRoleC = em.create(Role, { company: companyC, code: 'EMP', name: 'Emp C', isActive: true });
    em.create(RolePermission, { role: adminRoleA, permission: rbacManage, scope: Scope.COMPANY });
    em.create(RolePermission, { role: adminRoleB, permission: rbacManage, scope: Scope.COMPANY });

    const requester = em.create(AppUser, { username: 'req', email: 'req@x', status: 'ACTIVE' });
    const target = em.create(AppUser, { username: 'tgt', email: 'tgt@x', status: 'ACTIVE' });
    const linkUser = em.create(AppUser, { username: 'lnk', email: 'lnk@x', status: 'ACTIVE' });

    em.create(UserCompanyRole, { user: requester, company: companyA, department: deptA, role: adminRoleA, isDefault: true });
    em.create(UserCompanyRole, { user: requester, company: companyB, department: deptB, role: adminRoleB, isDefault: false });

    // Target: active in A, B, C — plus an EXPIRED role in A (must be dropped).
    em.create(UserCompanyRole, { user: target, company: companyA, department: deptA, role: adminRoleA, isDefault: true });
    em.create(UserCompanyRole, { user: target, company: companyB, department: deptB, role: adminRoleB, isDefault: false });
    em.create(UserCompanyRole, { user: target, company: companyC, department: deptC, role: plainRoleC, isDefault: false });
    em.create(UserCompanyRole, { user: target, company: companyA, department: deptA, role: staleRoleA, isDefault: false, validTo: PAST });

    // linkUser holds a role in A and B (to prove resignation only touches the active company).
    em.create(UserCompanyRole, { user: linkUser, company: companyA, department: deptA, role: adminRoleA, isDefault: true });
    em.create(UserCompanyRole, { user: linkUser, company: companyB, department: deptB, role: adminRoleB, isDefault: false });

    await em.flush();
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;
    ids.companyC = companyC.id;
    ids.deptA = deptA.id;
    ids.deptB = deptB.id;
    ids.requester = requester.id;
    ids.target = target.id;
    ids.linkUser = linkUser.id;
    ids.roleA = adminRoleA.id;
    ids.roleB = adminRoleB.id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  // ---- 4.1 CRUD + company scope ----------------------------------------------

  it('creates an employee and scopes the list to the active company', async () => {
    const created = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'E1', fullName: 'Alice', departmentId: ids.deptA }),
    );
    expect(created.status).toBe('ACTIVE');

    const listA = await asCtx(ids.companyA, () => employees.list());
    expect(listA.items.map((e) => e.empCode)).toContain('E1');

    // Company B must not see company A's employee.
    const listB = await asCtx(ids.companyB, () => employees.list());
    expect(listB.items.map((e) => e.empCode)).not.toContain('E1');
  });

  it('rejects a duplicate emp_code in the same company', async () => {
    await expect(
      asCtx(ids.companyA, () =>
        employees.create({ empCode: 'E1', fullName: 'Clash', departmentId: ids.deptA }),
      ),
    ).rejects.toThrow();
  });

  // ---- 4.3 Link / unlink does not touch assignments --------------------------

  it('link then unlink leaves user_company_role untouched', async () => {
    const emp = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'E2', fullName: 'Bob', departmentId: ids.deptA }),
    );
    const before = await orm.em.fork().count(UserCompanyRole, { user: ids.linkUser }, FILTER_OFF);

    const linked = await asCtx(ids.companyA, () => employees.link(emp.id, ids.linkUser));
    expect(linked.hasAccount).toBe(true);
    expect(linked.userId).toBe(ids.linkUser);

    const unlinked = await asCtx(ids.companyA, () => employees.unlink(emp.id));
    expect(unlinked.hasAccount).toBe(false);

    const after = await orm.em.fork().count(UserCompanyRole, { user: ids.linkUser }, FILTER_OFF);
    expect(after).toBe(before); // assignments unchanged by link/unlink
  });

  // ---- Create-and-link a login account (USER_PASSWORD) -----------------------

  it('creates a login account, links it, and stores a hash of USER_PASSWORD', async () => {
    process.env.USER_PASSWORD = 'Init@123';
    const emp = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'A1', fullName: 'New Hire', departmentId: ids.deptA }),
    );

    const linked = await asCtx(ids.companyA, () =>
      employees.createAccount(emp.id, { username: 'newhire', email: 'newhire@x' }),
    );
    expect(linked.hasAccount).toBe(true);
    expect(linked.userId).toBeTruthy();

    const user = await orm.em.fork().findOneOrFail(AppUser, { id: linked.userId! });
    expect(user.status).toBe('ACTIVE');
    // Stored as a hash, never the plaintext.
    expect(user.passwordHash).toBeTruthy();
    expect(user.passwordHash).not.toBe('Init@123');
    // The initial password authenticates.
    expect(await passwords.verify('Init@123', user.passwordHash!)).toBe(true);
  });

  it('rejects create-account when the employee already has an account', async () => {
    process.env.USER_PASSWORD = 'Init@123';
    const emp = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'A2', fullName: 'Dup Acct', departmentId: ids.deptA }),
    );
    await asCtx(ids.companyA, () => employees.createAccount(emp.id, { username: 'acct2', email: 'acct2@x' }));
    await expect(
      asCtx(ids.companyA, () => employees.createAccount(emp.id, { username: 'acct2b', email: 'acct2b@x' })),
    ).rejects.toThrow();
  });

  it('rejects a duplicate username or email (DB unique constraint authoritative)', async () => {
    process.env.USER_PASSWORD = 'Init@123';
    const e1 = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'A3', fullName: 'Uniq One', departmentId: ids.deptA }),
    );
    const e2 = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'A4', fullName: 'Uniq Two', departmentId: ids.deptA }),
    );
    await asCtx(ids.companyA, () => employees.createAccount(e1.id, { username: 'clash', email: 'clash@x' }));
    await expect(
      asCtx(ids.companyA, () => employees.createAccount(e2.id, { username: 'clash', email: 'other@x' })),
    ).rejects.toThrow();
    // The second employee stays unlinked — the failed account did not commit.
    const e2after = await asCtx(ids.companyA, () => employees.get(e2.id));
    expect(e2after.hasAccount).toBe(false);
  });

  it('fails closed when USER_PASSWORD is not configured', async () => {
    delete process.env.USER_PASSWORD;
    const emp = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'A5', fullName: 'No Pwd', departmentId: ids.deptA }),
    );
    await expect(
      asCtx(ids.companyA, () => employees.createAccount(emp.id, { username: 'nopwd', email: 'nopwd@x' })),
    ).rejects.toThrow();
    const after = await asCtx(ids.companyA, () => employees.get(emp.id));
    expect(after.hasAccount).toBe(false);
    process.env.USER_PASSWORD = 'Init@123';
  });

  it('two concurrent create-account calls with the same username: exactly one succeeds', async () => {
    process.env.USER_PASSWORD = 'Init@123';
    const e1 = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'A6', fullName: 'Race One', departmentId: ids.deptA }),
    );
    const e2 = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'A7', fullName: 'Race Two', departmentId: ids.deptA }),
    );
    const results = await Promise.allSettled([
      asCtx(ids.companyA, () => employees.createAccount(e1.id, { username: 'racer', email: 'r1@x' })),
      asCtx(ids.companyA, () => employees.createAccount(e2.id, { username: 'racer', email: 'r2@x' })),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
  });

  // ---- Linkable-accounts read (picker source) --------------------------------

  it('lists only accounts not linked to any employee, identity fields only', async () => {
    process.env.USER_PASSWORD = 'Init@123';
    // A fresh, never-linked account must appear.
    const fork = orm.em.fork();
    const free = fork.create(AppUser, { username: 'freeacct', email: 'free@x', status: 'ACTIVE' });
    await fork.persistAndFlush(free);

    // An account created + linked via createAccount must be excluded.
    const emp = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'L1', fullName: 'Linked', departmentId: ids.deptA }),
    );
    const linked = await asCtx(ids.companyA, () =>
      employees.createAccount(emp.id, { username: 'linkedacct', email: 'linked@x' }),
    );

    const accounts = await asCtx(ids.companyA, () => employees.listLinkableAccounts());
    const usernames = accounts.map((a) => a.username);
    expect(usernames).toContain('freeacct');
    expect(usernames).not.toContain('linkedacct');
    // linkUser is linked (E2 test) or target/requester may or may not be linked — assert the
    // just-linked account id is absent regardless.
    expect(accounts.map((a) => a.id)).not.toContain(linked.userId);
    // Identity only: no password/status/assignment fields leak.
    const one = accounts.find((a) => a.username === 'freeacct')!;
    expect(Object.keys(one).sort()).toEqual(['email', 'id', 'username']);
  });

  it('filters linkable accounts by username or email, case-insensitively', async () => {
    const fork = orm.em.fork();
    fork.create(AppUser, { username: 'SearchMe', email: 'findme@corp.io', status: 'ACTIVE' });
    await fork.flush();

    const byName = await asCtx(ids.companyA, () => employees.listLinkableAccounts('searchme'));
    expect(byName.map((a) => a.username)).toContain('SearchMe');

    const byEmail = await asCtx(ids.companyA, () => employees.listLinkableAccounts('FINDME'));
    expect(byEmail.map((a) => a.username)).toContain('SearchMe');

    const miss = await asCtx(ids.companyA, () => employees.listLinkableAccounts('no-such-term-xyz'));
    expect(miss.map((a) => a.username)).not.toContain('SearchMe');
  });

  // ---- Onboard: create account + first company access (default membership) ----

  it('onboards atomically: account ACTIVE, linked, default membership in the active company', async () => {
    process.env.USER_PASSWORD = 'Init@123';
    const emp = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'O1', fullName: 'Onboard One', departmentId: ids.deptA }),
    );

    const view = await asCtx(ids.companyA, () =>
      employees.onboard(emp.id, {
        username: 'onboardone',
        email: 'onboardone@x',
        roleId: ids.roleA,
        departmentId: ids.deptA,
      }),
    );
    expect(view.hasAccount).toBe(true);
    expect(view.userId).toBeTruthy();

    const user = await orm.em.fork().findOneOrFail(AppUser, { id: view.userId! });
    expect(user.status).toBe('ACTIVE');

    // A user_company_role exists in company A, marked default.
    const ucr = await orm.em
      .fork()
      .findOneOrFail(UserCompanyRole, { user: view.userId!, company: ids.companyA }, FILTER_OFF);
    expect(ucr.isDefault).toBe(true);

    // MembershipService resolves that company as default → login would issue a token.
    const companies = await new MembershipService(orm.em).listForUser(view.userId!);
    expect(companies).toHaveLength(1);
    expect(companies[0].id).toBe(ids.companyA);
    expect(companies[0].isDefault).toBe(true);
  });

  it('onboard company is the active company, not company from context confusion', async () => {
    process.env.USER_PASSWORD = 'Init@123';
    const emp = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'O2', fullName: 'Onboard Two', departmentId: ids.deptA }),
    );
    const view = await asCtx(ids.companyA, () =>
      employees.onboard(emp.id, { username: 'onboardtwo', email: 'o2@x', roleId: ids.roleA, departmentId: ids.deptA }),
    );
    const ucr = await orm.em.fork().findOneOrFail(UserCompanyRole, { user: view.userId! }, FILTER_OFF);
    expect(ucr.company.id).toBe(ids.companyA);
  });

  it('onboard rejects and persists nothing when USER_PASSWORD is unset', async () => {
    delete process.env.USER_PASSWORD;
    const emp = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'O3', fullName: 'No Pwd', departmentId: ids.deptA }),
    );
    await expect(
      asCtx(ids.companyA, () =>
        employees.onboard(emp.id, { username: 'o3', email: 'o3@x', roleId: ids.roleA, departmentId: ids.deptA }),
      ),
    ).rejects.toThrow();
    const after = await asCtx(ids.companyA, () => employees.get(emp.id));
    expect(after.hasAccount).toBe(false);
    process.env.USER_PASSWORD = 'Init@123';
  });

  it('onboard rejects a role not in the active company (no cross-company grant), atomically', async () => {
    process.env.USER_PASSWORD = 'Init@123';
    const emp = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'O4', fullName: 'Bad Role', departmentId: ids.deptA }),
    );
    // roleB belongs to company B; onboarding in company A must reject it.
    await expect(
      asCtx(ids.companyA, () =>
        employees.onboard(emp.id, { username: 'o4', email: 'o4@x', roleId: ids.roleB, departmentId: ids.deptA }),
      ),
    ).rejects.toThrow();
    const after = await asCtx(ids.companyA, () => employees.get(emp.id));
    expect(after.hasAccount).toBe(false); // nothing persisted
  });

  it('onboard rejects when the employee already has an account', async () => {
    process.env.USER_PASSWORD = 'Init@123';
    const emp = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'O5', fullName: 'Dup', departmentId: ids.deptA }),
    );
    await asCtx(ids.companyA, () => employees.createAccount(emp.id, { username: 'o5', email: 'o5@x' }));
    await expect(
      asCtx(ids.companyA, () =>
        employees.onboard(emp.id, { username: 'o5b', email: 'o5b@x', roleId: ids.roleA, departmentId: ids.deptA }),
      ),
    ).rejects.toThrow();
  });

  it('two concurrent onboards with the same username: exactly one succeeds, loser leaves no membership', async () => {
    process.env.USER_PASSWORD = 'Init@123';
    const e1 = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'O6', fullName: 'Race A', departmentId: ids.deptA }),
    );
    const e2 = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'O7', fullName: 'Race B', departmentId: ids.deptA }),
    );
    const results = await Promise.allSettled([
      asCtx(ids.companyA, () => employees.onboard(e1.id, { username: 'onboardrace', email: 'or1@x', roleId: ids.roleA, departmentId: ids.deptA })),
      asCtx(ids.companyA, () => employees.onboard(e2.id, { username: 'onboardrace', email: 'or2@x', roleId: ids.roleA, departmentId: ids.deptA })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    // The loser has no account and no membership.
    const memCount = await orm.em.fork().count(UserCompanyRole, { user: { username: 'onboardrace' } }, FILTER_OFF);
    expect(memCount).toBe(1); // only the winner's membership exists
  });

  // ---- Email verification -----------------------------------------------------

  it('a created account is unverified and gets a hashed, unconsumed verification token', async () => {
    process.env.USER_PASSWORD = 'Init@123';
    const emp = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'V1', fullName: 'Verify One', departmentId: ids.deptA }),
    );
    const view = await asCtx(ids.companyA, () =>
      employees.createAccount(emp.id, { username: 'verifyone', email: 'verifyone@x' }),
    );
    expect(view.emailVerified).toBe(false);

    const user = await orm.em.fork().findOneOrFail(AppUser, { id: view.userId! });
    expect(user.emailVerifiedAt).toBeFalsy();
    // A verification token exists, hashed (not the raw), unconsumed.
    const token = await orm.em.fork().findOne(EmailVerificationToken, { user: user.id, consumedAt: null });
    expect(token).toBeTruthy();
    expect(token!.tokenHash).toBeTruthy();
    expect(token!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('confirm verifies the account and consumes the token; reuse/invalid is rejected', async () => {
    process.env.USER_PASSWORD = 'Init@123';
    const emp = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'V2', fullName: 'Verify Two', departmentId: ids.deptA }),
    );
    const view = await asCtx(ids.companyA, () =>
      employees.createAccount(emp.id, { username: 'verifytwo', email: 'verifytwo@x' }),
    );
    // Issue a token we control the raw value of (createAccount's raw token isn't returned).
    const raw = randomBytes(32).toString('base64url');
    const em = orm.em.fork();
    em.create(EmailVerificationToken, {
      user: em.getReference(AppUser, view.userId!),
      tokenHash: createHash('sha256').update(raw).digest('hex'),
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    await em.flush();

    await emailVerification.confirm(raw);
    const user = await orm.em.fork().findOneOrFail(AppUser, { id: view.userId! });
    expect(user.emailVerifiedAt).toBeTruthy();

    // Reuse is rejected (single-use); a garbage token is rejected.
    await expect(emailVerification.confirm(raw)).rejects.toThrow();
    await expect(emailVerification.confirm('not-a-real-token')).rejects.toThrow();
  });

  it('markVerified (admin path) sets verification, is idempotent, and requires a linked account', async () => {
    process.env.USER_PASSWORD = 'Init@123';
    const emp = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'V3', fullName: 'Verify Three', departmentId: ids.deptA }),
    );
    // No account yet → verifyAccount rejects.
    await expect(asCtx(ids.companyA, () => employees.verifyAccount(emp.id))).rejects.toThrow();

    await asCtx(ids.companyA, () => employees.createAccount(emp.id, { username: 'verifythree', email: 'v3@x' }));
    const verified = await asCtx(ids.companyA, () => employees.verifyAccount(emp.id));
    expect(verified.emailVerified).toBe(true);

    const user1 = await orm.em.fork().findOneOrFail(AppUser, { id: verified.userId! });
    const firstAt = user1.emailVerifiedAt!;
    // Idempotent: re-verifying does not change the original timestamp.
    await asCtx(ids.companyA, () => employees.verifyAccount(emp.id));
    const user2 = await orm.em.fork().findOneOrFail(AppUser, { id: verified.userId! });
    expect(user2.emailVerifiedAt!.getTime()).toBe(firstAt.getTime());
  });

  // ---- 4.4 Salary masking ----------------------------------------------------

  it('masks salary unless the caller holds EMP_SALARY_VIEW', async () => {
    const emp = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'E3', fullName: 'Pay', departmentId: ids.deptA, salary: '50000.00' }),
    );

    const masked = await asCtx(ids.companyA, () => employees.get(emp.id));
    expect(masked.salary).toBeUndefined();

    const visible = await asCtx(ids.companyA, () => employees.get(emp.id), { grants: SALARY_GRANT });
    expect(visible.salary).toBe('50000.00');
  });

  // ---- 4.2 Resignation: one company only, atomic -----------------------------

  it('resignation flips status and expires only the active company, app_user intact', async () => {
    const emp = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'E4', fullName: 'Quit', departmentId: ids.deptA }),
    );
    await asCtx(ids.companyA, () => employees.link(emp.id, ids.linkUser));

    const res = await asCtx(ids.companyA, () => employees.resign(emp.id));
    expect(res.status).toBe('RESIGNED');
    expect(res.expired).toBeGreaterThan(0);

    const fork = orm.em.fork();
    // Company A access gone, company B intact.
    const a = await new PermissionResolverService(fork).resolve(ids.linkUser, ids.companyA);
    const b = await new PermissionResolverService(fork).resolve(ids.linkUser, ids.companyB);
    expect(a).toBeNull();
    expect(b).not.toBeNull();
    // The shared account is untouched.
    const user = await fork.findOneOrFail(AppUser, { id: ids.linkUser });
    expect(user.status).toBe('ACTIVE');
  });

  it('resignation of an unlinked employee flips status with no memberships expired', async () => {
    const emp = await asCtx(ids.companyA, () =>
      employees.create({ empCode: 'E5', fullName: 'Solo', departmentId: ids.deptA }),
    );
    const res = await asCtx(ids.companyA, () => employees.resign(emp.id));
    expect(res.status).toBe('RESIGNED');
    expect(res.expired).toBe(0);
  });

  // ---- 4.5 Cross-company read ------------------------------------------------

  it('returns only companies the requester administers, drops expired, writes nothing', async () => {
    const fork = orm.em.fork();
    const before = await fork.count(UserCompanyRole, {}, FILTER_OFF);

    const rows = await asCtx(ids.companyA, () => admin.crossCompanyAssignments(ids.target));
    const companyIds = rows.map((r) => r.companyId);

    // A and B are administered; C is not → excluded.
    expect(companyIds).toContain(ids.companyA);
    expect(companyIds).toContain(ids.companyB);
    expect(companyIds).not.toContain(ids.companyC);
    // The expired company-A assignment is not returned (one active A row only).
    expect(rows.filter((r) => r.companyId === ids.companyA)).toHaveLength(1);
    // Each row carries its validity window fields.
    expect(rows[0]).toHaveProperty('roleCode');

    const after = await orm.em.fork().count(UserCompanyRole, {}, FILTER_OFF);
    expect(after).toBe(before); // read-only
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[employee] no database reachable — skipping DB-backed spec');
}
