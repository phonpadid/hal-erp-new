import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { CurrencyController } from './currency.controller';
import { CurrencyService } from './currency.service';
import { Currency } from './currency.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

// --- Permission gate: any of DOC_CREATE / CURRENCY_VIEW / VENDOR_BANK_MANAGE (no DB needed) --
describe('GET /currencies/selectable permission gate', () => {
  const guard = new PermissionsGuard(new Reflector());
  const handler = CurrencyController.prototype.listSelectable;
  const ctx = (permissionCodes: string[]) =>
    ({
      getHandler: () => handler,
      getClass: () => CurrencyController,
      switchToHttp: () => ({ getRequest: () => ({ user: { permissionCodes } }) }),
    }) as any;

  it('allows a creator holding DOC_CREATE without CURRENCY_VIEW', () => {
    expect(guard.canActivate(ctx(['DOC_CREATE']))).toBe(true);
  });

  it('allows a currency administrator holding CURRENCY_VIEW without DOC_CREATE', () => {
    expect(guard.canActivate(ctx(['CURRENCY_VIEW']))).toBe(true);
  });

  /**
   * The vendor payee-account form picks a currency, and the role that fills it in holds neither of
   * the other two codes — gating on DOC_CREATE alone left that picker empty, and left every amount
   * that user reads at a default two decimal places, since decimal_places resolve from this read.
   */
  it('allows a vendor bank manager holding VENDOR_BANK_MANAGE alone', () => {
    expect(guard.canActivate(ctx(['VENDOR_BANK_MANAGE']))).toBe(true);
  });

  it('denies a user holding none of the three', () => {
    expect(() => guard.canActivate(ctx([]))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx(['MASTER_VIEW', 'DOC_VIEW']))).toThrow(ForbiddenException);
  });
});

// --- Read behaviour: active-only, trimmed projection (DB-backed) ---------------------------
const hasDb = await dbAvailable();

describe.skipIf(!hasDb)('selectable currencies read (DB-backed)', () => {
  let orm: MikroORM;
  let currencies: CurrencyService;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    em.create(Currency, { code: 'THB', name: 'Baht', symbol: '฿', decimalPlaces: 2, isActive: true });
    em.create(Currency, { code: 'JPY', name: 'Yen', symbol: '¥', decimalPlaces: 0, isActive: true });
    em.create(Currency, { code: 'OLD', name: 'Retired', decimalPlaces: 2, isActive: false });
    await em.flush();
    currencies = new CurrencyService(orm.em);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('returns active currencies ordered by code, with picker fields only', async () => {
    const rows = await currencies.listSelectable();
    expect(rows.map((c) => c.code)).toEqual(['JPY', 'THB']);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(['code', 'decimalPlaces', 'name', 'symbol']);
      expect((r as unknown as Record<string, unknown>).isActive).toBeUndefined();
    }
    expect(rows.find((c) => c.code === 'JPY')?.decimalPlaces).toBe(0);
  });

  it('excludes inactive currencies', async () => {
    const rows = await currencies.listSelectable();
    expect(rows.map((c) => c.code)).not.toContain('OLD');
  });
});
