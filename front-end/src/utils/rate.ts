/**
 * Display form for an exchange rate.
 *
 * `exchange_rate` is NUMERIC(18,8), so a rate of twenty-three thousand kip reads back from the
 * database as `23000.00000000` — eight zeros of scale that say nothing and make the figure hard to
 * check at a glance, which is the one thing a person confirming a rate has to do.
 *
 * Trailing zeros are dropped to two decimals: `23000.00000000` → `23000.00`, `26.5` → `26.50`.
 * Only ZEROS are dropped, and never below two decimals — a rate whose precision is real keeps it,
 * so `0.00003450` shortens to `0.0000345` rather than rounding to `0.00`. Rounding here would be a
 * screen quietly changing a figure that moves money.
 *
 * String in, string out. A rate is never a JS number on either side of the wire.
 */
export function formatRate(raw?: string | null): string {
  if (raw == null) return '';
  const value = String(raw).trim();
  if (!value) return '';
  // Anything that is not a plain decimal is handed back untouched: this formats, it does not judge.
  if (!/^-?\d*\.?\d+$/.test(value)) return value;

  const [whole, decimals = ''] = value.split('.');
  // Keep every digit up to the last non-zero one, then pad back out to two.
  const significant = decimals.replace(/0+$/, '');
  return `${whole}.${significant.padEnd(2, '0')}`;
}
