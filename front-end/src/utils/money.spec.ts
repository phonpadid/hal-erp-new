import { describe, expect, it } from 'vitest';
import { deriveAvailable, formatAmount } from './money';
import type { BalanceBreakdown } from '../api/budgets';

describe('formatAmount', () => {
  it('respects the currency decimal places', () => {
    expect(formatAmount('1000', 2)).toBe('1,000.00');
    expect(formatAmount('1000.5', 0)).toBe('1,001'); // JPY, rounds
    expect(formatAmount(null, 2)).toBe('0.00');
  });

  it('has no float drift', () => {
    expect(formatAmount('0.1', 2)).toBe('0.10');
    expect(formatAmount('19.99', 2)).toBe('19.99');
  });

  it('groups thousands across decimal_places of 0 / 2 / 3', () => {
    expect(formatAmount('1000000.00', 2)).toBe('1,000,000.00'); // the canonical case
    expect(formatAmount('1234567', 0)).toBe('1,234,567'); // zero-decimal currency: no separator
    expect(formatAmount('1234567.891', 3)).toBe('1,234,567.891'); // three-decimal currency
    expect(formatAmount('999', 2)).toBe('999.00'); // below the grouping threshold
  });

  it('keeps the sign on negative amounts and groups the digits', () => {
    expect(formatAmount('-1234567.89', 2)).toBe('-1,234,567.89');
  });

  it('formats zero at each precision', () => {
    expect(formatAmount('0', 0)).toBe('0');
    expect(formatAmount('0', 2)).toBe('0.00');
  });

  it("follows the active locale's separators", () => {
    // de groups with '.' and uses ',' as the decimal separator
    expect(formatAmount('1000000.5', 2, 'de')).toBe('1.000.000,50');
    // la (default) and en both use ',' grouping and '.' decimal
    expect(formatAmount('1000000.5', 2, 'la')).toBe('1,000,000.50');
    expect(formatAmount('1000000.5', 2, 'en')).toBe('1,000,000.50');
  });

  it('never coerces the amount to a JS number (precision beyond MAX_SAFE_INTEGER)', () => {
    // 9_007_199_254_740_993 = Number.MAX_SAFE_INTEGER + 2, which a JS number cannot hold exactly
    expect(formatAmount('9007199254740993.01', 2)).toBe('9,007,199,254,740,993.01');
  });
});

describe('deriveAvailable', () => {
  it('reconciles to the derived-balance formula', () => {
    const b: BalanceBreakdown = {
      amountTotal: '1000000', adjustIncrease: '50000', adjustDecrease: '0',
      transferIn: '0', transferOut: '100000', reserved: '250000', actual: '300000',
      released: '20000', available: 'ignored',
    };
    // 1,000,000 + 50,000 − 100,000 − 250,000 − 300,000 + 20,000 = 420,000
    expect(deriveAvailable(b)).toBe('420000');
  });
});
