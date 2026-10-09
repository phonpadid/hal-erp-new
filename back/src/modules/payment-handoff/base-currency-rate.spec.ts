import { describe, expect, it } from 'vitest';
import { assertRateFitsCurrency } from './base-currency-rate';

/**
 * The predicate alone, with no database and no services: every call site reaches the same four
 * answers, and a test that has to build a payment to ask "is 695 allowed on a LAK document?" is one
 * nobody reads when the rule changes.
 */
describe('a base-currency document has no rate but one', () => {
  it('refuses a rate other than 1 when the document is in the base currency', () => {
    expect(() => assertRateFitsCurrency('LAK', 'LAK', '695')).toThrow(/can only be 1/i);
  });

  it('refuses it for a document with NO currency, which means the base currency', () => {
    expect(() => assertRateFitsCurrency(undefined, 'LAK', '695')).toThrow(/LAK/);
  });

  it('names the figure it refused, so the message says what to correct', () => {
    expect(() => assertRateFitsCurrency('LAK', 'LAK', '695')).toThrow(/695/);
  });

  it('accepts 1, however it is spelled', () => {
    expect(() => assertRateFitsCurrency('LAK', 'LAK', '1')).not.toThrow();
    expect(() => assertRateFitsCurrency('LAK', 'LAK', '1.00000000')).not.toThrow();
    expect(() => assertRateFitsCurrency(undefined, 'LAK', '1.00')).not.toThrow();
  });

  it('accepts no rate at all — a slip may evidence cash and state nothing', () => {
    expect(() => assertRateFitsCurrency('LAK', 'LAK', undefined)).not.toThrow();
    expect(() => assertRateFitsCurrency('USD', 'LAK', undefined)).not.toThrow();
  });

  it('leaves a foreign-currency document alone', () => {
    expect(() => assertRateFitsCurrency('USD', 'LAK', '22650')).not.toThrow();
    expect(() => assertRateFitsCurrency('THB', 'LAK', '695')).not.toThrow();
  });

  it('judges by the currency, not by the rate — a foreign currency at parity still restates', () => {
    expect(() => assertRateFitsCurrency('USD', 'LAK', '1')).not.toThrow();
    expect(() => assertRateFitsCurrency('USD', 'LAK', '1.05')).not.toThrow();
  });
});
