import { useCurrencyStore } from '../stores/currency';
import { useAuthStore } from '../stores/auth';
import { formatAmount } from '../utils/money';

/**
 * Currency-aware amount formatting. Resolves a currency's `decimal_places` from the
 * currency store (default 2) and the active company's base currency from the auth store,
 * feeding the shared `formatAmount` util (decimal-string, never a JS number).
 */
export function useCurrencyFormat() {
  const currency = useCurrencyStore();
  const auth = useAuthStore();

  // Ensure the registry is available so decimal_places resolve (no-op if already loaded).
  // Load active currencies so decimal_places resolve. Use the DOC_CREATE-gated picklist (not the
  // CURRENCY_VIEW admin list) so formatting works for non-admin users; no-op once loaded. Falls
  // back to the admin list if a page already populated it.
  if (!currency.selectableCurrencies.length && !currency.currencies.length) {
    void currency.loadSelectableCurrencies();
  }

  const decimalPlacesOf = (code?: string | null): number => {
    if (!code) return 2;
    const found =
      currency.selectableCurrencies.find((c) => c.code === code) ??
      currency.currencies.find((c) => c.code === code);
    return found?.decimalPlaces ?? 2;
  };

  const baseCode = () => auth.baseCurrency?.code;
  const baseDecimalPlaces = () => auth.baseCurrency?.decimalPlaces ?? 2;

  /** Format an amount in the given currency code. */
  const fmt = (value: string | null | undefined, code?: string | null): string =>
    formatAmount(value, decimalPlacesOf(code));

  /** Format an amount in the active company's base currency. */
  const fmtBase = (value: string | null | undefined): string =>
    formatAmount(value, baseDecimalPlaces());

  return { decimalPlacesOf, baseCode, baseDecimalPlaces, fmt, fmtBase };
}
