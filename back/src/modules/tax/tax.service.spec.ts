import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { TaxKind } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Company } from '../multi-company/multi-company.entities';
import { TaxService } from './tax.service';
import type { MikroORM } from '@mikro-orm/postgresql';

describe('TaxService.computeLineVat (pure)', () => {
  it('rounds line VAT to the currency decimal places', () => {
    expect(TaxService.computeLineVat('1000', '0.07', 2)).toBe('70.00');
    expect(TaxService.computeLineVat('333.33', '0.07', 2)).toBe('23.33'); // 23.3331 → 23.33
    expect(TaxService.computeLineVat('1000', '0.07', 0)).toBe('70');
  });

  it('document tax_total is the sum of rounded per-line amounts (no drift)', () => {
    const lines = ['33.33', '66.67', '100.00'];
    const perLine = lines.map((n) => TaxService.computeLineVat(n, '0.07', 2));
    const taxTotal = perLine.reduce((s, t) => (Number(s) + Number(t)).toFixed(2), '0.00');
    // Σ rounded lines, not a single round of the whole — this is what the submit flow stamps.
    expect(perLine).toEqual(['2.33', '4.67', '7.00']);
    expect(taxTotal).toBe('14.00');
  });

  it('computeWht rounds the withheld amount on the net base', () => {
    expect(TaxService.computeWht('100000', '0.03', 2)).toBe('3000.00');
    expect(TaxService.computeWht('1234.56', '0.05', 2)).toBe('61.73'); // 61.728 → 61.73
  });
});

const hasDb = await dbAvailable();

describe.skipIf(!hasDb)('TaxService CRUD (DB-backed)', () => {
  let orm: MikroORM;
  let tax: TaxService;
  let companyA = '';
  let companyB = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    tax = new TaxService(orm.em, new CompanyScopeService(orm.em));
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const a = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const b = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    await em.flush();
    companyA = a.id; companyB = b.id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const asA = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId: companyA, grants: [] }, fn);
  const asB = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId: companyB, grants: [] }, fn);

  it('enforces per-company code uniqueness and isolation', async () => {
    await asA(() => tax.create({ code: 'VAT7', name: 'VAT 7%', kind: TaxKind.VAT, rate: '0.07' }));
    await expect(asA(() => tax.create({ code: 'VAT7', name: 'dup', kind: TaxKind.VAT, rate: '0.07' }))).rejects.toThrow(/already exists/);
    // Same code in another company is fine, and A cannot see B's codes.
    await asB(() => tax.create({ code: 'VAT7', name: 'B VAT', kind: TaxKind.VAT, rate: '0.10' }));
    const listA = await asA(() => tax.list({ limit: 100 }, true));
    expect(listA.items.every((t) => t.company.id === companyA)).toBe(true);
    expect(listA.items).toHaveLength(1);
  });

  it('lists only active VAT codes as selectable', async () => {
    await asA(() => tax.create({ code: 'VAT0', name: 'Zero-rated', kind: TaxKind.VAT, rate: '0', isActive: false }));
    const sel = await asA(() => tax.listSelectableVat());
    expect(sel.some((t) => t.code === 'VAT7')).toBe(true);
    expect(sel.some((t) => t.code === 'VAT0')).toBe(false); // inactive excluded
  });
});
