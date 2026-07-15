import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Scope } from '../../common/enums';
import { RequestContext } from '../../common/context/request-context';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company, Department } from '../multi-company/multi-company.entities';
import { PermissionResolverService } from '../rbac/permission-resolver.service';
import { AppUser, Permission, Role, RolePermission, UserCompanyRole } from '../rbac/rbac.entities';
import { ApiKeyService } from './api-key.service';
import { ApiKey } from './external-api.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

/** Run a service call inside the active-company request context it reads. */
function asCompany<T>(companyId: string, userId: string, cb: () => Promise<T>): Promise<T> {
  return RequestContext.run({ companyId, userId, grants: [] }, cb);
}

describe.skipIf(!hasDb)('ApiKeyService (DB-backed)', () => {
  let orm: MikroORM;
  let service: ApiKeyService;

  const ids = { companyA: '', companyB: '', deptA: '', adminA: '', botA: '', outsiderB: '' };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    service = new ApiKeyService(orm.em, new PermissionResolverService(orm.em));

    const em = orm.em.fork();
    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const companyB = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'DA', isActive: true });
    const deptB = em.create(Department, { company: companyB, deptCode: 'DB', name: 'DB', isActive: true });

    const docCreate = em.create(Permission, { code: 'DOC_CREATE', name: 'Create', module: 'DOCUMENT', isActive: true });
    const docSubmit = em.create(Permission, { code: 'DOC_SUBMIT', name: 'Submit', module: 'DOCUMENT', isActive: true });
    const docApprove = em.create(Permission, { code: 'DOC_APPROVE', name: 'Approve', module: 'DOCUMENT', isActive: true });

    // Bot role in A holds create+submit AND approve (to prove the key still can't approve).
    const botRole = em.create(Role, { company: companyA, code: 'BOT', name: 'Bot', isActive: true });
    em.create(RolePermission, { role: botRole, permission: docCreate, scope: Scope.DEPARTMENT });
    em.create(RolePermission, { role: botRole, permission: docSubmit, scope: Scope.DEPARTMENT });
    em.create(RolePermission, { role: botRole, permission: docApprove, scope: Scope.COMPANY });

    const now = new Date();
    const admin = em.create(AppUser, { username: 'adminA', email: 'adminA@x', status: 'ACTIVE', emailVerifiedAt: now });
    const bot = em.create(AppUser, { username: 'botA', email: 'botA@x', status: 'ACTIVE', emailVerifiedAt: now });
    const outsider = em.create(AppUser, { username: 'outB', email: 'outB@x', status: 'ACTIVE', emailVerifiedAt: now });

    // bot is a member of A; outsider only of B.
    em.create(UserCompanyRole, { user: bot, company: companyA, department: deptA, role: botRole, isDefault: true });
    const roleB = em.create(Role, { company: companyB, code: 'RB', name: 'RB', isActive: true });
    em.create(UserCompanyRole, { user: outsider, company: companyB, department: deptB, role: roleB, isDefault: true });

    await em.flush();
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;
    ids.deptA = deptA.id;
    ids.adminA = admin.id;
    ids.botA = bot.id;
    ids.outsiderB = outsider.id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('issues a key and authenticates it to the bound user\'s live grants', async () => {
    const { secret, prefix } = await asCompany(ids.companyA, ids.adminA, () =>
      service.issue('bot key', ids.botA, undefined),
    );
    expect(prefix.startsWith('ak_')).toBe(true);
    expect(secret.startsWith(`${prefix}.`)).toBe(true);

    const principal = await service.authenticate(secret);
    expect(principal.userId).toBe(ids.botA);
    expect(principal.companyId).toBe(ids.companyA); // company isolation
    expect(principal.authSource).toBe('api-key');
    expect(principal.permissionCodes).toContain('DOC_CREATE'); // may create/submit
    expect(principal.permissionCodes).toContain('DOC_SUBMIT');
    // The bound user DOES hold DOC_APPROVE — the channel cap (ApiKeyDenyGuard), not the
    // grants, is what stops a key from approving. Grants still reflect the user faithfully.
    expect(principal.permissionCodes).toContain('DOC_APPROVE');
  });

  it('rejects an invalid secret', async () => {
    await expect(service.authenticate('ak_deadbeef.notarealsecret')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.authenticate('garbage-no-dot')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a revoked key', async () => {
    const { id, secret } = await asCompany(ids.companyA, ids.adminA, () =>
      service.issue('revoke me', ids.botA, undefined),
    );
    await asCompany(ids.companyA, ids.adminA, () => service.revoke(id));
    await expect(service.authenticate(secret)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired key', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { secret } = await asCompany(ids.companyA, ids.adminA, () =>
      service.issue('expired', ids.botA, past),
    );
    await expect(service.authenticate(secret)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses to issue for a user who is not a member of the active company', async () => {
    await expect(
      asCompany(ids.companyA, ids.adminA, () => service.issue('x', ids.outsiderB, undefined)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('scopes listing and revocation to the active company', async () => {
    const { id } = await asCompany(ids.companyA, ids.adminA, () =>
      service.issue('a key', ids.botA, undefined),
    );
    // Company B cannot see or revoke company A's key.
    const listB = await asCompany(ids.companyB, ids.outsiderB, () => service.list());
    expect(listB.find((k) => k.id === id)).toBeUndefined();
    await expect(
      asCompany(ids.companyB, ids.outsiderB, () => service.revoke(id)),
    ).rejects.toThrow();

    const listA = await asCompany(ids.companyA, ids.adminA, () => service.list());
    const view = listA.find((k) => k.id === id)!;
    expect(view).toBeDefined();
    // Non-secret metadata only.
    expect(view).not.toHaveProperty('secret');
    expect(view).not.toHaveProperty('secretHash');
    expect(view.status).toBe('active');
  });

  it('never issues duplicate prefixes under concurrent issuance', async () => {
    const N = 25;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        asCompany(ids.companyA, ids.adminA, () => service.issue(`k${i}`, ids.botA, undefined)),
      ),
    );
    const prefixes = results.map((r) => r.prefix);
    expect(new Set(prefixes).size).toBe(N);

    // And the DB agrees the prefixes are unique.
    const rows = await orm.em.fork().find(ApiKey, {}, { filters: { company: false } });
    const dbPrefixes = rows.map((r) => r.prefix);
    expect(new Set(dbPrefixes).size).toBe(dbPrefixes.length);
  });
});
