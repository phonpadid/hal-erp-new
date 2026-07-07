import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currencyCreateSchema, exchangeRateSchema } from '@erp/shared';
import { useCurrencyStore } from './currency';
import { currencyApi } from '../api/currency';

vi.mock('../api/currency', () => ({
  currencyApi: {
    currencies: { list: vi.fn(), selectable: vi.fn(), create: vi.fn(), update: vi.fn() },
    rates: { list: vi.fn(), create: vi.fn() },
  },
}));

const c = currencyApi as any;

describe('currency shared schemas', () => {
  it('accepts valid payloads', () => {
    expect(currencyCreateSchema.safeParse({ code: 'USD', name: 'US Dollar', decimalPlaces: 2 }).success).toBe(true);
    expect(exchangeRateSchema.safeParse({ fromCurrency: 'USD', toCurrency: 'THB', rate: '35.5', rateDate: '2026-01-01' }).success).toBe(true);
  });

  it('rejects bad code length, non-numeric rate, and missing required', () => {
    expect(currencyCreateSchema.safeParse({ code: 'US', name: 'x' }).success).toBe(false); // too short
    expect(currencyCreateSchema.safeParse({ code: 'usd', name: 'x' }).success).toBe(false); // lowercase
    expect(exchangeRateSchema.safeParse({ fromCurrency: 'USD', toCurrency: 'THB', rate: 'abc', rateDate: '2026-01-01' }).success).toBe(false);
    expect(exchangeRateSchema.safeParse({ fromCurrency: 'USD', toCurrency: 'THB', rate: '1' }).success).toBe(false); // no date
  });
});

describe('useCurrencyStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    c.currencies.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 });
    c.rates.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
  });

  it('loadCurrencies and loadRates populate (loadRates passes the filter)', async () => {
    c.currencies.list.mockResolvedValueOnce({ items: [{ code: 'USD', name: 'US Dollar' }], total: 1, page: 1, limit: 100 });
    c.rates.list.mockResolvedValueOnce({ items: [{ id: 'r1', rate: '35' }], total: 1, page: 1, limit: 20 });
    const s = useCurrencyStore();
    await s.loadCurrencies();
    await s.loadRates({ from: 'USD', to: 'THB' });
    expect(s.currencies).toHaveLength(1);
    expect(s.rates).toHaveLength(1);
    expect(c.rates.list).toHaveBeenCalledWith({ from: 'USD', to: 'THB' }, 1, 20);
  });

  it('loadSelectableCurrencies fills the picker state without touching the admin list', async () => {
    c.currencies.selectable.mockResolvedValueOnce([
      { code: 'THB', name: 'Baht', symbol: '฿', decimalPlaces: 2 },
      { code: 'JPY', name: 'Yen', symbol: '¥', decimalPlaces: 0 },
    ]);
    const s = useCurrencyStore();
    await s.loadSelectableCurrencies();
    expect(s.selectableCurrencies.map((x) => x.code)).toEqual(['THB', 'JPY']);
    expect(c.currencies.list).not.toHaveBeenCalled(); // admin list untouched
    expect(s.currencies).toHaveLength(0);
  });

  it('createCurrency and addRate call the endpoint and refresh', async () => {
    c.currencies.create.mockResolvedValueOnce(undefined);
    c.rates.create.mockResolvedValueOnce(undefined);
    const s = useCurrencyStore();
    expect(await s.createCurrency({ code: 'EUR', name: 'Euro' })).toBe(true);
    expect(c.currencies.create).toHaveBeenCalled();
    expect(c.currencies.list).toHaveBeenCalled(); // refreshed
    expect(await s.addRate({ fromCurrency: 'USD', toCurrency: 'THB', rate: '35', rateDate: '2026-01-01' })).toBe(true);
    expect(c.rates.create).toHaveBeenCalled();
  });

  it('captures a server error and returns false', async () => {
    c.rates.create.mockRejectedValueOnce({ response: { data: { message: 'duplicate rate' } } });
    const s = useCurrencyStore();
    expect(await s.addRate({})).toBe(false);
    expect(s.error).toBe('duplicate rate');
  });
});
