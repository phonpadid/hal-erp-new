import { Reflector } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { syncPermissionCatalog } from '../../seed/seed-data';
import { PermissionCatalogService } from './permission-catalog.service';
import { RbacAdminController } from './rbac-admin.controller';
import { Permission } from './rbac.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

/**
 * `GET /rbac/permissions/missing` — what the catalog cannot offer.
 *
 * The admin screen lists grantable codes. Without this read it lists sixty-three and says nothing
 * about the twelve that are declared, enforced, routed, and grantable to nobody — which is how an
 * installation sat unable to close an accounting period with no screen admitting it.
 */
describe.skipIf(!hasDb)('missing-permissions read (DB-backed)', () => {
  let orm: MikroORM;
  let catalog: PermissionCatalogService;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    catalog = new PermissionCatalogService(orm.em as never);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const controller = () => new RbacAdminController(null as never, catalog);

  it('returns exactly the absent codes when the catalog is short', async () => {
    await syncPermissionCatalog(orm.em.fork());
    await orm.em
      .fork()
      .nativeDelete(Permission, { code: { $in: ['PERIOD_CLOSE', 'PERIOD_REOPEN'] } });

    await expect(controller().missingPermissions()).resolves.toEqual({
      codes: ['PERIOD_CLOSE', 'PERIOD_REOPEN'],
    });
  });

  it('returns none when every declared code has a row', async () => {
    await syncPermissionCatalog(orm.em.fork());

    await expect(controller().missingPermissions()).resolves.toEqual({ codes: [] });
  });

  it('does not report an undeclared row as missing', async () => {
    await syncPermissionCatalog(orm.em.fork());
    const em = orm.em.fork();
    em.create(Permission, {
      code: 'RETIRED_CODE_NOT_IN_SOURCE',
      name: 'Retired',
      module: 'RETIRED',
      isActive: true,
    });
    await em.flush();

    // The catalog is additive: a retired row keeps its grants and is not a fault.
    await expect(controller().missingPermissions()).resolves.toEqual({ codes: [] });
  });
});

/**
 * The read sits on a controller gated as a whole, so it inherits `RBAC_MANAGE` rather than
 * declaring its own. Asserted here because "inherits" is the kind of thing that stops being true
 * when someone adds a second decorator.
 */
describe('missing-permissions read is gated', () => {
  const guard = new PermissionsGuard(new Reflector());
  const ctx = (permissionCodes: string[]) =>
    ({
      getHandler: () => RbacAdminController.prototype.missingPermissions,
      getClass: () => RbacAdminController,
      switchToHttp: () => ({ getRequest: () => ({ user: { permissionCodes } }) }),
    }) as never;

  it('allows a caller holding RBAC_MANAGE', () => {
    expect(guard.canActivate(ctx(['RBAC_MANAGE']))).toBe(true);
  });

  it('refuses a caller without it, whatever else they hold', () => {
    expect(() => guard.canActivate(ctx(['DOC_VIEW', 'PERIOD_CLOSE']))).toThrow();
  });
});
