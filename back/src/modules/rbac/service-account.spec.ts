import { JwtService } from '@nestjs/jwt';
import { PATH_METADATA } from '@nestjs/common/constants';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AuthService } from '../../auth/auth.service';
import { PERMISSIONS_KEY } from '../../auth/require-permissions.decorator';
import { RequestContext } from '../../common/context/request-context';
import { StorageService } from '../../common/storage/storage.service';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Scope } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { ApiKeyService } from '../external-api/api-key.service';
import { JobLevelService } from '../job-level/job-level.service';
import { Company, Department } from '../multi-company/multi-company.entities';
import { EmailTransport } from '../notification/transports/transport';
import { MailQueue } from '../notification/transports/mail-queue';
import { CreateServiceAccountDto } from './dto/admin.dto';
import { EmailVerificationService } from './email-verification.service';
import { EmployeeService } from './employee.service';
import { MembershipService } from './membership.service';
import { RbacPermissions } from './permissions';
import { RbacAdminController } from './rbac-admin.controller';
import { PasswordService } from './password.service';
import { PermissionResolverService } from './permission-resolver.service';
import { RbacAuthService } from './rbac-auth.service';
import { RoleAdminService } from './role-admin.service';
import { AppUser, Permission, Role, RolePermission, UserCompanyRole } from './rbac.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Service accounts: a non-human identity that authenticates ONLY by an API key. These cover the
 * two properties that make it safe — it cannot sign in interactively, and it is never mistaken
 * for a person — plus the atomic creation that lets it hold a key at all.
 */
describe.skipIf(!hasDb)('service accounts (DB-backed)', () => {
  let orm: MikroORM;
  let admin: RoleAdminService;
  let auth: RbacAuthService;
  let employees: EmployeeService;
  let apiKeys: ApiKeyService;
  const passwords = new PasswordService();

  const ids = {
    companyA: '',
    companyB: '',
    deptA: '',
    deptB: '',
    roleA: '',
    roleB: '',
    human: '',
  };

  const asA = <T>(fn: () => Promise<T>, userId = ids.human) =>
    RequestContext.run({ userId, companyId: ids.companyA, departmentId: '', grants: [] }, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const resolver = new PermissionResolverService(orm.em);
    admin = new RoleAdminService(orm.em, resolver);
    auth = new RbacAuthService(
      orm.em,
      passwords,
      resolver,
      new MembershipService(orm.em),
      new AuthService(new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '1h' } })),
      new StorageService(),
    );
    employees = new EmployeeService(
      orm.em,
      passwords,
      new EmailVerificationService(orm.em, new MailQueue(new EmailTransport())),
      new JobLevelService(orm.em, new CompanyScopeService(orm.em)),
    );
    apiKeys = new ApiKeyService(orm.em, resolver);

    const em = orm.em.fork();
    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const companyB = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'DA', isActive: true });
    const deptB = em.create(Department, { company: companyB, deptCode: 'DB', name: 'DB', isActive: true });
    const docView = em.create(Permission, { code: 'DOC_VIEW', name: 'View', module: 'DOCUMENT', isActive: true });
    const roleA = em.create(Role, { company: companyA, code: 'BOT', name: 'Bot A', isActive: true });
    const roleB = em.create(Role, { company: companyB, code: 'BOT', name: 'Bot B', isActive: true });
    em.create(RolePermission, { role: roleA, permission: docView, scope: Scope.DEPARTMENT });

    // A person with a real password, to compare login outcomes against.
    const human = em.create(AppUser, {
      username: 'alice', email: 'alice@x', passwordHash: await passwords.hash('secret'),
      status: 'ACTIVE', emailVerifiedAt: new Date(),
    });
    em.create(UserCompanyRole, { user: human, company: companyA, department: deptA, role: roleA, isDefault: true });

    await em.flush();
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;
    ids.deptA = deptA.id;
    ids.deptB = deptB.id;
    ids.roleA = roleA.id;
    ids.roleB = roleB.id;
    ids.human = human.id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const create = (over: Partial<{ username: string; email: string; roleId: string; departmentId: string }> = {}) =>
    asA(() =>
      admin.createServiceAccount({
        username: 'bot-1', email: 'bot-1@x', roleId: ids.roleA, departmentId: ids.deptA, ...over,
      }),
    );

  it('creates a marked, passwordless account with its first company assignment', async () => {
    const created = await create();
    expect(created.isServiceAccount).toBe(true);

    const em = orm.em.fork();
    const row = await em.findOneOrFail(AppUser, { username: 'bot-1' }, FILTER_OFF);
    expect(row.isServiceAccount).toBe(true);
    expect(row.passwordHash).toBeFalsy(); // never set, and USER_PASSWORD is not read here
    expect(row.emailVerifiedAt).toBeTruthy(); // never reported as a person awaiting verification
    expect(row.status).toBe('ACTIVE');

    const ucr = await em.findOne(UserCompanyRole, { user: row.id, company: ids.companyA }, FILTER_OFF);
    expect(ucr).toBeTruthy();
    expect(ucr!.isDefault).toBe(true);
  });

  it('never returns a password hash to the caller', async () => {
    const created = await create({ username: 'bot-hash', email: 'bot-hash@x' });
    expect(JSON.stringify(created)).not.toContain('passwordHash');
  });

  it('rejects a role from another company and creates nothing', async () => {
    await expect(create({ username: 'bot-x', email: 'bot-x@x', roleId: ids.roleB })).rejects.toThrow();
    expect(await orm.em.fork().findOne(AppUser, { username: 'bot-x' }, FILTER_OFF)).toBeNull();
  });

  it('rejects a department from another company and creates nothing', async () => {
    await expect(
      create({ username: 'bot-y', email: 'bot-y@x', departmentId: ids.deptB }),
    ).rejects.toThrow();
    expect(await orm.em.fork().findOne(AppUser, { username: 'bot-y' }, FILTER_OFF)).toBeNull();
  });

  it('rejects a duplicate username, leaving no account and no assignment behind', async () => {
    const em = orm.em.fork();
    const before = await em.count(UserCompanyRole, { company: ids.companyA }, FILTER_OFF);

    // 'bot-1' exists from the first test; the flush fails on the unique constraint, which is
    // also the atomicity proof — the assignment queued in the same transaction must not survive.
    await expect(create({ username: 'bot-1', email: 'other@x' })).rejects.toThrow();

    const after = await orm.em.fork().count(UserCompanyRole, { company: ids.companyA }, FILTER_OFF);
    expect(after).toBe(before);
    expect(await orm.em.fork().findOne(AppUser, { email: 'other@x' }, FILTER_OFF)).toBeNull();
  });

  it('rejects a duplicate email', async () => {
    await expect(create({ username: 'bot-other', email: 'bot-1@x' })).rejects.toThrow();
    expect(await orm.em.fork().findOne(AppUser, { username: 'bot-other' }, FILTER_OFF)).toBeNull();
  });

  it('denies interactive login, indistinguishably from a wrong password', async () => {
    const asBot = await auth.login('bot-1', 'anything').catch((e) => e);
    const asHumanWrongPw = await auth.login('alice', 'wrong').catch((e) => e);

    expect(asBot.constructor).toBe(asHumanWrongPw.constructor);
    expect(asBot.message).toBe(asHumanWrongPw.message);
    // Sanity: the same human logs in fine with the right password, so the comparison above is
    // between two failures rather than between two broken paths.
    await expect(auth.login('alice', 'secret')).resolves.toBeTruthy();
  });

  it('denies login even if a password hash is somehow present', async () => {
    const em = orm.em.fork();
    const bot = await em.findOneOrFail(AppUser, { username: 'bot-1' }, FILTER_OFF);
    bot.passwordHash = await passwords.hash('secret');
    await em.flush();

    // The denial keys off the identity kind, not the missing hash — that is the whole point.
    await expect(auth.login('bot-1', 'secret')).rejects.toThrow();

    bot.passwordHash = undefined;
    await em.flush();
  });

  it('is an eligible API-key target immediately after creation', async () => {
    const created = await create({ username: 'bot-key', email: 'bot-key@x' });
    const eligible = await asA(() => apiKeys.eligibleUsers());
    expect(eligible.map((u) => u.id)).toContain(created.id);
  });

  it('authenticates by API key, resolving to the bound principal with its codes', async () => {
    const created = await create({ username: 'bot-auth', email: 'bot-auth@x' });
    const issued = await asA(() => apiKeys.issue('claim', created.id, undefined));

    const principal = await apiKeys.authenticate(issued.secret);
    expect(principal.userId).toBe(created.id);
    expect(principal.grants.map((g) => g.code)).toContain('DOC_VIEW');
  });

  it('is never offered in the employee linkable-account picker', async () => {
    await create({ username: 'bot-link', email: 'bot-link@x' });

    const all = await asA(() => employees.listLinkableAccounts());
    expect(all.map((a) => a.username)).not.toContain('bot-link');
    // Not even when the search term matches it exactly.
    const searched = await asA(() => employees.listLinkableAccounts('bot-link'));
    expect(searched).toEqual([]);
    // The human is still offered, so the exclusion is targeted rather than a broken read.
    expect((await asA(() => employees.listLinkableAccounts('alice'))).map((a) => a.username)).toEqual(['alice']);
  });

  it('does not treat a passwordless HUMAN as a service account', async () => {
    const em = orm.em.fork();
    const pending = em.create(AppUser, {
      username: 'no-pw-human', email: 'no-pw@x', status: 'ACTIVE', emailVerifiedAt: new Date(),
    });
    em.create(UserCompanyRole, {
      user: pending, company: em.getReference(Company, ids.companyA),
      department: em.getReference(Department, ids.deptA), role: em.getReference(Role, ids.roleA),
      isDefault: false,
    });
    await em.flush();

    const row = await orm.em.fork().findOneOrFail(AppUser, { username: 'no-pw-human' }, FILTER_OFF);
    expect(row.passwordHash).toBeFalsy();
    expect(row.isServiceAccount).toBe(false); // the marker, not the inference

    // And unlike a service account it is still a person to be linked to an employee.
    const linkable = await asA(() => employees.listLinkableAccounts('no-pw-human'));
    expect(linkable.map((a) => a.username)).toEqual(['no-pw-human']);
  });

  it('reports the marker on the admin user list', async () => {
    const { items } = await asA(() => admin.listUsers({ limit: 100 }));
    expect(items.find((u) => u.username === 'bot-1')?.isServiceAccount).toBe(true);
    expect(items.find((u) => u.username === 'alice')?.isServiceAccount).toBe(false);
  });
});

/** The route guard and the query contract are provable without a database. */
describe('service-account route + DTO contract', () => {
  it('the RBAC admin controller requires RBAC_MANAGE, so the route is not open', () => {
    const codes = Reflect.getMetadata(PERMISSIONS_KEY, RbacAdminController);
    expect(codes).toContain(RbacPermissions.RBAC_MANAGE);
    // No method-level override on this route → it inherits the class guard rather than widening it.
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, RbacAdminController.prototype.createServiceAccount),
    ).toBeUndefined();
  });

  it('is a POST "service-accounts" route that delegates to the service', () => {
    const path = Reflect.getMetadata(
      PATH_METADATA,
      RbacAdminController.prototype.createServiceAccount,
    );
    expect(path).toBe('service-accounts');

    const calls: unknown[] = [];
    const service = {
      createServiceAccount: (dto: unknown) => (calls.push(dto), {}),
    } as unknown as RoleAdminService;
    const dto = { username: 'bot', email: 'bot@x.com', roleId: 'r', departmentId: 'd' };
    new RbacAdminController(service).createServiceAccount(dto as never);
    expect(calls).toEqual([dto]);
  });

  describe('CreateServiceAccountDto', () => {
    const q = (over: Record<string, unknown>) =>
      plainToInstance(CreateServiceAccountDto, {
        username: 'claim-bot', email: 'claim-bot@hal.local',
        roleId: '11111111-1111-4111-8111-111111111111',
        departmentId: '22222222-2222-4222-8222-222222222222',
        ...over,
      });

    it('accepts a valid payload', async () => {
      expect(await validate(q({}))).toHaveLength(0);
    });

    it('exposes no password field, so one can never be supplied', async () => {
      // The DTO declares no such property...
      expect(Object.keys(q({}))).not.toContain('password');
      // ...and main.ts runs the global pipe with whitelist + forbidNonWhitelisted, so sending one
      // is REJECTED rather than silently ignored. Validate under those same options.
      const errors = await validate(q({ password: 'hunter2' }), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors.map((e) => e.property)).toEqual(['password']);
    });

    it('requires a username and a well-formed email', async () => {
      expect((await validate(q({ username: undefined }))).map((e) => e.property)).toEqual(['username']);
      expect((await validate(q({ email: 'not-an-email' }))).map((e) => e.property)).toEqual(['email']);
      expect((await validate(q({ email: undefined }))).map((e) => e.property)).toEqual(['email']);
    });

    it('requires role and department to be UUIDs', async () => {
      expect((await validate(q({ roleId: 'nope' }))).map((e) => e.property)).toEqual(['roleId']);
      expect((await validate(q({ departmentId: 'nope' }))).map((e) => e.property)).toEqual(['departmentId']);
    });
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[service-account] no database reachable — skipping DB-backed spec');
}
