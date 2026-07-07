import { describe, expect, it } from 'vitest';
import { Money } from './money';

describe('Money', () => {
  it('keeps precision that a JS number would lose', () => {
    // 0.1 + 0.2 !== 0.3 with floats; Money stays exact.
    expect(Money.add('0.1', '0.2')).toBe('0.3');
    expect(Money.subtract('1000000000000.05', '0.04')).toBe('1000000000000.01');
  });

  it('rejects raw JS numbers', () => {
    // @ts-expect-error — numbers are forbidden for money.
    expect(() => Money.of(1.23)).toThrow();
  });

  it('compares and rounds by currency decimal places', () => {
    expect(Money.compare('10.00', '9.99')).toBe(1);
    expect(Money.round('1234.5', 0)).toBe('1235'); // JPY
    expect(Money.round('1234.005', 2)).toBe('1234.01'); // THB
  });

  it('multiplies exactly (amount × FX rate)', () => {
    expect(Money.multiply('19.99', '1000')).toBe('19990');
    // A float would drift here; Decimal stays exact.
    expect(Money.multiply('0.1', '0.2')).toBe('0.02');
    expect(Money.multiply('12345.67', '1.23456789')).toBe('15241.5677625363');
  });
});
