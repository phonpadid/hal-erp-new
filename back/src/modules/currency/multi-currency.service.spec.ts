import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company } from '../multi-company/multi-company.entities';
import { Currency, ExchangeRate } from './currency.entities';
import { ExchangeRateService } from './exchange-rate.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

describe.skipIf(!hasDb)('multi-currency: rate resolution & conversion (DB-backed)', () => {
  let orm: MikroORM;
  let rates: ExchangeRateService;
  let companyA = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const lak = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 2, isActive: true });
    const jpy = em.create(Currency, { code: 'JPY', name: 'Yen', decimalPlaces: 0, isActive: true });
    const usd = em.create(Currency, { code: 'USD', name: 'Dollar', decimalPlaces: 2, isActive: true });
    const a = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });

    // Group rates.
    em.create(ExchangeRate, { fromCurrency: thb, toCurrency: lak, rate: '250', rateDate: '2026-01-01', rateType: 'DAILY' });
    em.create(ExchangeRate, { fromCurrency: thb, toCurrency: lak, rate: '260', rateDate: '2026-02-01', rateType: 'DAILY' });
    em.create(ExchangeRate, { fromCurrency: usd, toCurrency: thb, rate: '35', rateDate: '2026-01-01', rateType: 'DAILY' });
    em.create(ExchangeRate, { fromCurrency: thb, toCurrency: jpy, rate: '3.7', rateDate: '2026-01-01', rateType: 'DAILY' });
    // Company A override for THB→LAK.
    em.create(ExchangeRate, { company: a, fromCurrency: thb, toCurrency: lak, rate: '255', rateDate: '2026-01-01', rateType: 'DAILY' });

    await em.flush();
    companyA = a.id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    rates = new ExchangeRateService(orm.em);
  });

  // ---- 5.1 As-of-deterministic latest rate -----------------------------------

  it('picks the latest rate on or before asOf; a later rate does not move it', async () => {
    const jan = await rates.resolveRate({ from: 'THB', to: 'LAK', asOf: '2026-01-15' });
    expect(Number(jan.rate)).toBe(250); // decimal(18,8) → "250.00000000"
    expect(jan.source).toBe('GROUP');

    const feb = await rates.resolveRate({ from: 'THB', to: 'LAK', asOf: '2026-02-15' });
    expect(Number(feb.rate)).toBe(260);
  });

  // ---- 5.2 Company override beats group --------------------------------------

  it('prefers a company override over the group rate', async () => {
    const override = await rates.resolveRate({ from: 'THB', to: 'LAK', asOf: '2026-01-15', companyId: companyA });
    expect(Number(override.rate)).toBe(255);
    expect(override.source).toBe('COMPANY');

    const group = await rates.resolveRate({ from: 'THB', to: 'LAK', asOf: '2026-01-15' });
    expect(group.source).toBe('GROUP');
  });

  // ---- 5.3 Identity & inverse ------------------------------------------------

  it('resolves identity to 1 and falls back to the inverse pair', async () => {
    const identity = await rates.resolveRate({ from: 'THB', to: 'THB', asOf: '2026-01-15' });
    expect(identity).toMatchObject({ rate: '1', source: 'IDENTITY' });

    // Only USD→THB (35) exists; THB→USD resolves to 1/35.
    const inverse = await rates.resolveRate({ from: 'THB', to: 'USD', asOf: '2026-01-15' });
    expect(inverse.source).toBe('INVERSE');
    expect(inverse.rate).toBe('0.028571428571428571429');
  });

  // ---- 5.4 Conversion rounds to target decimal_places ------------------------

  it('converts and rounds to the target currency decimal places', async () => {
    // THB→LAK (2 dp): 100 × 250 = 25000.00
    const lak = await rates.convert({ amount: '100', from: 'THB', to: 'LAK', asOf: '2026-01-15' });
    expect(lak.baseAmount).toBe('25000.00');
    expect(Number(lak.rate)).toBe(250);

    // THB→JPY (0 dp): 1.5 × 3.7 = 5.55 → 6
    const jpy = await rates.convert({ amount: '1.5', from: 'THB', to: 'JPY', asOf: '2026-01-15' });
    expect(jpy.baseAmount).toBe('6');
  });

  // ---- 5.5 No rate -----------------------------------------------------------

  it('rejects when no rate (direct or inverse) is available', async () => {
    await expect(
      rates.resolveRate({ from: 'LAK', to: 'USD', asOf: '2026-01-15' }),
    ).rejects.toThrow();
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[multi-currency] no database reachable — skipping DB-backed spec');
}
