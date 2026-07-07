import { useI18n } from 'vue-i18n';
import { formatAmount } from '@/utils/money';

/**
 * Locale-aware formatting helpers. Dates and plain counts go through vue-i18n
 * (active-locale formats from i18n/formats.ts); money goes through the currency
 * `decimal_places` helper and is never coerced to a JS number.
 */
export function useFormat() {
  const { d, n } = useI18n();

  const formatDate = (value: string | number | Date | null | undefined, key: 'short' | 'long' = 'short') =>
    value == null || value === '' ? '—' : d(new Date(value), key);

  const formatCount = (value: number | null | undefined) =>
    value == null ? '—' : n(value, 'integer');

  /** Money: pass the currency's decimal_places. Input/output stays a string. */
  const formatMoney = (value: string | null | undefined, decimalPlaces = 2) =>
    formatAmount(value, decimalPlaces);

  return { formatDate, formatCount, formatMoney };
}
