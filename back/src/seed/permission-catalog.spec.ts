import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../test/test-orm';
import { Role, RolePermission, AppUser, Permission } from '../modules/rbac/rbac.entities';
import { Company } from '../modules/multi-company/multi-company.entities';
import {
  declaredPermissionCodes,
  missingPermissionCodes,
  syncPermissionCatalog,
} from './seed-data';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The permission catalog.
 *
 * A code is declared in TypeScript and named by a decorator, but it is only grantable if a row
 * exists: the admin list reads the table, and granting resolves codes to rows first. Deploy a
 * slice without its rows and every endpoint behind them answers 403 with nothing in the product
 * able to fix it — which is why this reconcile runs unattended on production, and why what it is
 * NOT allowed to create matters as much as what it creates.
 */
describe.skipIf(!hasDb)('syncPermissionCatalog (DB-backed)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('inserts a row for every declared code, and creates nothing else', async () => {
    const em = orm.em.fork();
    expect(await em.count(Permission)).toBe(0);

    await syncPermissionCatalog(em);

    const em2 = orm.em.fork();
    const codes = (await em2.find(Permission, {})).map((p) => p.code).sort();
    expect(codes).toEqual([...declaredPermissionCodes()].sort());

    // The reason this command exists rather than `seeder:run`: the seeder would also manufacture a
    // company, roles, and loginable users on any environment missing them.
    expect(await em2.count(Company, {}, FILTER_OFF)).toBe(0);
    expect(await em2.count(AppUser)).toBe(0);
    expect(await em2.count(Role, {}, FILTER_OFF)).toBe(0);
  });

  it('changes nothing on a second run', async () => {
    const em = orm.em.fork();
    const before = await em.count(Permission);
    const ids = (await em.find(Permission, {})).map((p) => p.id).sort();

    await syncPermissionCatalog(orm.em.fork());

    const em2 = orm.em.fork();
    expect(await em2.count(Permission)).toBe(before);
    // Same rows, not replacements: a re-run must not churn ids that grants point at.
    expect((await em2.find(Permission, {})).map((p) => p.id).sort()).toEqual(ids);
  });

  it('leaves a row whose code is no longer declared, and its grant, untouched', async () => {
    // Additive on purpose: an unattended command that runs on production should add what is
    // missing, not decide what should disappear. A retired code keeps its row so that a role which
    // was granted it stays valid rather than losing a permission nobody asked it to lose.
    const em = orm.em.fork();
    const retired = em.create(Permission, {
      code: 'RETIRED_CODE_NOT_IN_SOURCE',
      name: 'Retired',
      module: 'RETIRED',
      isActive: true,
    });
    const company = em.create(Company, {
      code: 'PERMCAT',
      nameTh: 'Permission catalog fixture',
      branchCode: '00000',
      isActive: true,
      createdAt: new Date(),
    } as never);
    await em.flush();
    const role = em.create(Role, {
      company,
      code: 'RETIRED_HOLDER',
      name: 'Retired holder',
      isActive: true,
    } as never);
    await em.flush();
    const grant = em.create(RolePermission, { role, permission: retired } as never);
    await em.flush();

    await syncPermissionCatalog(orm.em.fork());

    const em2 = orm.em.fork();
    const stillThere = await em2.findOne(Permission, { code: 'RETIRED_CODE_NOT_IN_SOURCE' });
    expect(stillThere).not.toBeNull();
    expect(stillThere!.isActive).toBe(true);
    expect(await em2.findOne(RolePermission, { id: grant.id }, FILTER_OFF)).not.toBeNull();
  });
});

/**
 * The comparison behind `permissions:check`. Pure, so the rule is provable without a database —
 * the script around it only supplies the rows.
 */
describe('missingPermissionCodes', () => {
  it('names every declared code with no row', () => {
    const declared = declaredPermissionCodes();
    const present = declared.slice(2);
    const missing = missingPermissionCodes(present);

    expect(missing).toEqual([...declared.slice(0, 2)].sort());
  });

  it('reports nothing when every declared code has a row', () => {
    expect(missingPermissionCodes(declaredPermissionCodes())).toEqual([]);
  });

  it('does not treat an undeclared row as a problem', () => {
    // Extra rows are the expected end state of an additive catalog, not a failure.
    expect(missingPermissionCodes([...declaredPermissionCodes(), 'RETIRED_CODE'])).toEqual([]);
  });

  it('reports an empty environment as missing everything', () => {
    expect(missingPermissionCodes([])).toEqual([...declaredPermissionCodes()].sort());
  });
});
