import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Scope } from '../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../test/test-orm';
import { AuthService } from '../auth/auth.service';
import { StorageService } from '../common/storage/storage.service';
import { Company, Department } from '../modules/multi-company/multi-company.entities';
import { MembershipService } from '../modules/rbac/membership.service';
import { PasswordService } from '../modules/rbac/password.service';
import { PermissionResolverService } from '../modules/rbac/permission-resolver.service';
import { RbacAuthService } from '../modules/rbac/rbac-auth.service';
import {
  AppUser,
  Permission,
  Role,
  RolePermission,
  UserCompanyRole,
} from '../modules/rbac/rbac.entities';
import { ReportingPermissions } from '../modules/reporting/permissions';
import {
  BOOTSTRAP_ENV,
  bootstrapAdmin,
  redact,
  resolveBootstrapInput,
  type BootstrapAdminInput,
} from './bootstrap-admin';
import { seedEssentials } from './seed-essentials';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

const INPUT: BootstrapAdminInput = {
  username: 'first.admin',
  email: 'first.admin@example.test',
  password: 'Bootstrap1',
  companyCode: 'ACME',
  companyName: 'Acme Holdings',
  currencyCode: 'LAK',
};

/**
 * The bootstrap exists because a production database is unreachable without it, and it is
 * dangerous for exactly the same reason: it creates an account holding every permission code.
 * So the interesting tests here are the refusals, not the happy path.
 */
describe.skipIf(!hasDb)('bootstrap-admin (DB-backed)', () => {
  let orm: MikroORM;
  let jwt: JwtService;
  let auth: RbacAuthService;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    jwt = new JwtService({ secret: 'bootstrap-test', signOptions: { expiresIn: '1h' } });
    auth = new RbacAuthService(
      orm.em,
      new PasswordService(),
      new PermissionResolverService(orm.em),
      new MembershipService(orm.em),
      new AuthService(jwt),
      new StorageService(),
    );
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  /** Each test starts from what a real production database looks like the moment before: seeded, empty of people. */
  beforeEach(async () => {
    await orm.schema.refreshDatabase();
    await seedEssentials(orm.em.fork());
  });

  const rowCounts = async () => {
    const em = orm.em.fork();

    return {
      companies: await em.count(Company, {}, FILTER_OFF),
      departments: await em.count(Department, {}, FILTER_OFF),
      roles: await em.count(Role, {}, FILTER_OFF),
      grants: await em.count(RolePermission, {}, FILTER_OFF),
      users: await em.count(AppUser, {}, FILTER_OFF),
      memberships: await em.count(UserCompanyRole, {}, FILTER_OFF),
    };
  };

  it('creates the six rows a person needs in order to sign in', async () => {
    const report = await bootstrapAdmin(orm.em.fork(), INPUT);

    expect(await rowCounts()).toMatchObject({
      companies: 1,
      departments: 1,
      roles: 1,
      users: 1,
      memberships: 1,
    });

    const em = orm.em.fork();
    const company = await em.findOneOrFail(Company, { code: INPUT.companyCode }, FILTER_OFF);
    expect(company.id).toBe(report.companyId);
    // `currency` is keyed by code, not a surrogate id — a company whose base currency is wrong
    // denominates every budget in it wrongly, and nothing else in the system would notice.
    expect(company.baseCurrency?.code).toBe(INPUT.currencyCode);
  });

  /**
   * The whole point, asserted end to end: everything above is a row count, and a row count is not
   * a login. This is the test that fails if any one of the six rows is subtly wrong.
   */
  it('produces an account that can actually sign in and administer the company', async () => {
    const report = await bootstrapAdmin(orm.em.fork(), INPUT);

    const result = await auth.login(INPUT.username, INPUT.password);

    expect(result.accessToken).toBeTruthy();
    const payload = jwt.verify<JwtPayload>(result.accessToken!);
    // A token with no company is an account that logged in and has nowhere to go.
    expect(payload.companyId).toBe(report.companyId);

    // The codes behind the screens that let the administrator replace this account with real ones.
    const codes = payload.grants.map((g) => g.code);
    expect(codes).toContain('RBAC_MANAGE');
    expect(codes).toContain('COMPANY_MANAGE');
    expect(codes).toContain('EMPLOYEE_MANAGE');
    expect(codes.length).toBe(report.grants);
  });

  it('rejects the wrong password for that account', async () => {
    await bootstrapAdmin(orm.em.fork(), INPUT);

    await expect(auth.login(INPUT.username, 'Wrong12345')).rejects.toThrow();
  });

  it('makes the membership the default company, so login needs no second step', async () => {
    await bootstrapAdmin(orm.em.fork(), INPUT);

    const [membership] = await orm.em
      .fork()
      .find(UserCompanyRole, {}, { ...FILTER_OFF, populate: ['user', 'role', 'department'] });

    expect(membership.isDefault).toBe(true);
    expect(membership.user.username).toBe(INPUT.username);
    expect(membership.role.code).toBe('ADMIN');
    expect(membership.department.deptCode).toBe('HQ');
    // No validity window: a membership that has expired is a membership login will not resolve.
    expect(membership.validFrom ?? null).toBeNull();
    expect(membership.validTo ?? null).toBeNull();
  });

  it('creates the account already verified — login rejects an unverified one', async () => {
    await bootstrapAdmin(orm.em.fork(), INPUT);

    const user = await orm.em.fork().findOneOrFail(AppUser, { username: INPUT.username }, FILTER_OFF);
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(user.status).toBe('ACTIVE');
  });

  it('stores a hash that verifies the password, never the password', async () => {
    await bootstrapAdmin(orm.em.fork(), INPUT);

    const user = await orm.em.fork().findOneOrFail(
      AppUser,
      { username: INPUT.username },
      { ...FILTER_OFF, populate: ['passwordHash'] },
    );

    expect(user.passwordHash).toBeDefined();
    expect(user.passwordHash).not.toBe(INPUT.password);
    expect(await new PasswordService().verify(INPUT.password, user.passwordHash!)).toBe(true);
  });

  it('grants the ADMIN role every active permission, group reporting at GROUP scope', async () => {
    const report = await bootstrapAdmin(orm.em.fork(), INPUT);

    const em = orm.em.fork();
    // Asserted against the catalog rather than a fixed number: a release that adds codes must
    // grant them too, or the first administrator silently loses the new screens.
    const active = await em.count(Permission, { isActive: true }, FILTER_OFF);
    expect(report.grants).toBe(active);
    expect(await em.count(RolePermission, {}, FILTER_OFF)).toBe(active);

    const grants = await em.find(RolePermission, {}, { ...FILTER_OFF, populate: ['permission'] });
    const group = grants.filter((g) => g.scope === Scope.GROUP);
    expect(group).toHaveLength(1);
    expect(group[0].permission.code).toBe(ReportingPermissions.REPORT_GROUP_VIEW);
    expect(grants.filter((g) => g.scope !== Scope.COMPANY && g.scope !== Scope.GROUP)).toHaveLength(0);
  });

  it('REFUSES a database that already holds an account, and writes nothing', async () => {
    await bootstrapAdmin(orm.em.fork(), INPUT);
    const before = await rowCounts();

    await expect(
      bootstrapAdmin(orm.em.fork(), { ...INPUT, username: 'second', email: 'second@example.test', companyCode: 'OTHER' }),
    ).rejects.toThrow(/already holds/i);

    expect(await rowCounts()).toEqual(before);
  });

  it('refuses on the same terms when the only account is inactive and has no membership', async () => {
    const em = orm.em.fork();
    em.create(AppUser, {
      username: 'dormant',
      email: 'dormant@example.test',
      passwordHash: 'x',
      status: 'INACTIVE',
    });
    await em.flush();

    await expect(bootstrapAdmin(orm.em.fork(), INPUT)).rejects.toThrow(/already holds/i);
    expect((await rowCounts()).companies).toBe(0);
  });

  it('refuses an empty permission catalog, naming the command that fills it', async () => {
    await orm.em.fork().nativeDelete(Permission, {});

    await expect(bootstrapAdmin(orm.em.fork(), INPUT)).rejects.toThrow(/seed:prod/);
    expect(await rowCounts()).toMatchObject({ companies: 0, users: 0 });
  });

  it('refuses a currency it cannot resolve, rather than a company with no base currency', async () => {
    await expect(bootstrapAdmin(orm.em.fork(), { ...INPUT, currencyCode: 'XXX' })).rejects.toThrow(
      /not an active currency/i,
    );
    expect(await rowCounts()).toMatchObject({ companies: 0, users: 0 });
  });

  it('refuses a password the product itself would reject', async () => {
    // Seven characters, and no digit: two ways to fail the shared policy at once.
    await expect(bootstrapAdmin(orm.em.fork(), { ...INPUT, password: 'shortpw' })).rejects.toThrow(
      /BOOTSTRAP_PASSWORD/,
    );
    expect(await rowCounts()).toMatchObject({ users: 0 });
  });

  it.each(Object.entries(BOOTSTRAP_ENV))(
    'refuses an empty %s and writes nothing',
    async (field, variable) => {
      await expect(
        bootstrapAdmin(orm.em.fork(), { ...INPUT, [field]: '  ' } as BootstrapAdminInput),
      ).rejects.toThrow(variable);

      expect(await rowCounts()).toMatchObject({ companies: 0, users: 0 });
    },
  );

  it('leaves nothing behind when the transaction fails part-way', async () => {
    // A company code longer than the column allows: the insert reaches the database and is
    // rejected there, after the account has already been created in the same unit of work.
    await expect(
      bootstrapAdmin(orm.em.fork(), { ...INPUT, companyCode: 'X'.repeat(500) }),
    ).rejects.toThrow();

    expect(await rowCounts()).toEqual({
      companies: 0,
      departments: 0,
      roles: 0,
      grants: 0,
      users: 0,
      memberships: 0,
    });
  });
});

describe('bootstrap-admin (pure)', () => {
  it('names the variable that is missing, before anything connects', () => {
    expect(() => resolveBootstrapInput({})).toThrow(BOOTSTRAP_ENV.username);
    expect(() =>
      resolveBootstrapInput({ [BOOTSTRAP_ENV.username]: 'a', [BOOTSTRAP_ENV.email]: 'b' }),
    ).toThrow(BOOTSTRAP_ENV.password);
  });

  it('treats whitespace as absence', () => {
    const env = Object.fromEntries(Object.values(BOOTSTRAP_ENV).map((v) => [v, 'x']));
    expect(() => resolveBootstrapInput({ ...env, [BOOTSTRAP_ENV.companyCode]: '   ' })).toThrow(
      BOOTSTRAP_ENV.companyCode,
    );
  });

  it('trims what it accepts', () => {
    const env = Object.fromEntries(Object.values(BOOTSTRAP_ENV).map((v) => [v, ' padded ']));
    expect(resolveBootstrapInput(env).username).toBe('padded');
  });

  it('scrubs the password out of anything on its way to a log', () => {
    expect(redact('connection failed for Bootstrap1 at host', 'Bootstrap1')).toBe(
      'connection failed for «redacted» at host',
    );
    // An unset password must not turn every message into redaction.
    expect(redact('nothing to hide', '')).toBe('nothing to hide');
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[bootstrap-admin] no database reachable — skipping DB-backed spec');
}
