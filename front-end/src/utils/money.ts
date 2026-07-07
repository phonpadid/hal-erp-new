import { Decimal } from 'decimal.js';
import type { BalanceBreakdown } from '../api/budgets';
import { i18n } from '../i18n';

/** Resolve the active locale's grouping and decimal separators, defaulting to `,`/`.`. */
function localeSeparators(locale: string): { group: string; decimal: string } {
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(11111.1);
    return {
      group: parts.find((p) => p.type === 'group')?.value ?? ',',
      decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
    };
  } catch {
    return { group: ',', decimal: '.' };
  }
}

/**
 * Format a decimal-string amount to the currency's places with locale-aware thousands
 * grouping — never via a JS number. The fixed-precision value comes from `Decimal`, then
 * separators are applied to that string; the amount is never coerced to a JS number, so
 * precision holds for arbitrarily large values. `decimalPlaces = 0` yields a grouped
 * integer with no decimal separator. `locale` defaults to the active i18n locale.
 */
export function formatAmount(
  value: string | null | undefined,
  decimalPlaces = 2,
  locale: string = (i18n.global.locale as unknown as { value: string }).value,
): string {
  const fixed = new Decimal(value || '0').toFixed(decimalPlaces);
  const negative = fixed.startsWith('-');
  const unsigned = negative ? fixed.slice(1) : fixed;
  const [intPart, fracPart] = unsigned.split('.');
  const { group, decimal } = localeSeparators(locale || 'en');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const out = fracPart != null ? `${grouped}${decimal}${fracPart}` : grouped;
  return negative ? `-${out}` : out;
}

/** Sum decimal-string amounts without ever coercing money to a JS number. */
export function sumAmounts(values: Array<string | null | undefined>): string {
  return values.reduce<Decimal>((acc, v) => acc.plus(v || '0'), new Decimal(0)).toString();
}

/**
 * Recompute available from the breakdown components (mirrors the server's derived-balance
 * formula, invariant 3) — used to assert the detail card reconciles.
 */
export function deriveAvailable(b: BalanceBreakdown): string {
  return new Decimal(b.amountTotal || '0')
    .plus(b.adjustIncrease || '0')
    .minus(b.adjustDecrease || '0')
    .plus(b.transferIn || '0')
    .minus(b.transferOut || '0')
    .minus(b.reserved || '0')
    .minus(b.actual || '0')
    .plus(b.released || '0')
    .toString();
}
