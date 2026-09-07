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

/** The active i18n locale, as `formatAmount` resolves it. */
function activeLocale(): string {
  return (i18n.global.locale as unknown as { value: string }).value;
}

/**
 * Group the integer part of an amount the user is still TYPING, for display in an input.
 *
 * Separate from `formatAmount` because that one calls `toFixed`, which is right for a figure being
 * read and wrong for one being typed: it would turn `100` into `100.00` between two keystrokes and
 * fight the person at the keyboard. This keeps the fraction exactly as typed, trailing decimal mark
 * and all, and never rounds.
 *
 * A keyboard types `.` whatever the page language is, so `.` is accepted as the decimal mark
 * alongside the locale's own. Everything else is dropped, which is what makes the field
 * paste-proof: an amount pasted with its old separators regroups to this locale's.
 *
 * Never a JS number, here or anywhere money is handled (money rule) — this is string surgery.
 */
export function groupDigits(raw: string, locale: string = activeLocale()): string {
  if (!raw) return '';
  const { group, decimal } = localeSeparators(locale || 'en');
  const negative = raw.trimStart().startsWith('-');
  let seenDecimal = false;
  let intPart = '';
  let fracPart = '';
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      if (seenDecimal) fracPart += ch;
      else intPart += ch;
    } else if (!seenDecimal && (ch === '.' || ch === decimal)) {
      seenDecimal = true;
    }
  }
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const body = seenDecimal ? `${grouped}${decimal}${fracPart}` : grouped;
  return negative && body ? `-${body}` : body;
}

/**
 * The inverse: a grouped display string back to the plain decimal string the wire and the shared
 * Zod schema expect (`.` as the decimal mark, no grouping).
 *
 * The form field holds the GROUPED text so the person sees their separators; this is what stands
 * between that and every consumer of the value, so the client and the server never disagree about
 * what was typed (money rule, and the one-schema rule in CLAUDE.md).
 */
export function stripGrouping(display: string, locale: string = activeLocale()): string {
  if (!display) return '';
  const { decimal } = localeSeparators(locale || 'en');
  const negative = display.trimStart().startsWith('-');
  let seenDecimal = false;
  let out = '';
  for (const ch of display) {
    if (ch >= '0' && ch <= '9') out += ch;
    else if (!seenDecimal && (ch === '.' || ch === decimal)) {
      seenDecimal = true;
      out += '.';
    }
  }
  return negative && out ? `-${out}` : out;
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
