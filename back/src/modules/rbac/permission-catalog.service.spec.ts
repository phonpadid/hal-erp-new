import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import {
  declaredPermissionCodes,
  missingPermissionCodes,
  syncPermissionCatalog,
} from '../../seed/seed-data';
import { Permission } from './rbac.entities';
import { PermissionCatalogService } from './permission-catalog.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

/**
 * The report the application makes about its own catalog at startup.
 *
 * A code with no row cannot be granted to anyone, so the capability behind it is unreachable for
 * the whole installation. `permissions:sync` and `permissions:check` cover a deploy; a database
 * that arrives by restore never meets either, which is how this installation came to be twelve
 * codes short with nothing in the product saying so.
 */
describe.skipIf(!hasDb)('PermissionCatalogService (DB-backed)', () => {
  let orm: MikroORM;
  let service: PermissionCatalogService;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    service = new PermissionCatalogService(orm.em as never);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  afterEach(() => vi.restoreAllMocks());

  /** Leaves the catalog complete except for `codes`. */
  async function catalogShortOf(codes: string[]): Promise<void> {
    await syncPermissionCatalog(orm.em.fork());
    if (codes.length) await orm.em.fork().nativeDelete(Permission, { code: { $in: codes } });
  }

  it('names the codes an environment is short of, and starts anyway', async () => {
    await catalogShortOf(['PERIOD_CLOSE', 'GL_JV_POST']);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledOnce();
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('PERIOD_CLOSE');
    expect(message).toContain('GL_JV_POST');
    // Actionable: the reader's next move is named, not left to be guessed.
    expect(message).toContain('permissions:sync');
  });

  it('says nothing when every declared code has a row', async () => {
    await catalogShortOf([]);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await service.onApplicationBootstrap();

    expect(warn).not.toHaveBeenCalled();
  });

  it('writes no permission row', async () => {
    await catalogShortOf(['PERIOD_REOPEN']);
    const em = orm.em.fork();
    const before = (await em.find(Permission, {})).map((p) => `${p.id}:${p.code}`).sort();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await service.onApplicationBootstrap();

    const after = (await orm.em.fork().find(Permission, {})).map((p) => `${p.id}:${p.code}`).sort();
    expect(after).toEqual(before);
    // Still missing: the report is not a reconcile in disguise.
    expect(await service.missing()).toEqual(['PERIOD_REOPEN']);
  });

  it('reports the same set the check command would, from the same fixture', async () => {
    await catalogShortOf(['VAT_FILE', 'WHT_REMIT', 'BANK_ACCOUNT_VIEW']);

    // What `permissions:check` computes, spelled out here rather than imported from the script,
    // because the script's value is that it needs no application context.
    const rows = await orm.em.fork().find(Permission, {}, { fields: ['code'] });
    const asTheCheckWouldSee = missingPermissionCodes(rows.map((p) => p.code));

    expect(await service.missing()).toEqual(asTheCheckWouldSee);
    expect(asTheCheckWouldSee).toEqual(['BANK_ACCOUNT_VIEW', 'VAT_FILE', 'WHT_REMIT']);
  });

  it('survives a catalog it cannot read, rather than taking the boot down', async () => {
    const broken = new PermissionCatalogService({
      fork: () => {
        throw new Error('connection refused');
      },
    } as never);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(broken.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(String(warn.mock.calls[0][0])).toContain('connection refused');
  });

  it('measures against every declared code, not a copy of the list', async () => {
    await catalogShortOf([]);
    await orm.em.fork().nativeDelete(Permission, {});

    expect(await service.missing()).toEqual([...declaredPermissionCodes()].sort());

    await syncPermissionCatalog(orm.em.fork());
  });
});
