import { Decimal } from 'decimal.js';

/**
 * Money helper. Amounts are DECIMAL/NUMERIC carried as strings end-to-end —
 * never a JS number (loses precision). Services use this instead of `+`/`-`.
 */
export class Money {
  /** Parse a string/Decimal amount; throws on a raw JS number to enforce the rule. */
  static of(value: string | Decimal): Decimal {
    if (typeof value === 'number') {
      throw new TypeError('Money values must be strings, not JS numbers');
    }
    return new Decimal(value);
  }

  static add(a: string, b: string): string {
    return new Decimal(a).plus(b).toString();
  }

  static subtract(a: string, b: string): string {
    return new Decimal(a).minus(b).toString();
  }

  /** Exact decimal multiply (e.g. amount × FX rate). String in/out. */
  static multiply(a: string, b: string): string {
    return new Decimal(a).times(b).toString();
  }

  /** Exact decimal divide (e.g. re-rate a base amount). String in/out. Throws on divide-by-zero. */
  static divide(a: string, b: string): string {
    if (new Decimal(b).isZero()) throw new Error('Money.divide by zero');
    return new Decimal(a).div(b).toString();
  }

  static compare(a: string, b: string): -1 | 0 | 1 {
    return new Decimal(a).comparedTo(b) as -1 | 0 | 1;
  }

  /** Round to a currency's decimal_places (e.g. JPY = 0, THB = 2). */
  static round(value: string, decimalPlaces: number): string {
    return new Decimal(value).toFixed(decimalPlaces);
  }
}
