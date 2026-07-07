## Why

Monetary amounts in the web app currently render with no thousands separators —
`1000000.00` is shown verbatim, which is hard to read and easy to misjudge by an
order of magnitude on budget and document screens. Users want grouped digits
(`1,000,000.00`). The grouping must be added without breaking the money invariants:
amounts are decimal strings (never JS numbers) and are formatted to the currency's
`decimal_places` (not a hardcoded 2).

## What Changes

- Add thousands-separator grouping to the shared money-display helpers
  (`formatAmount` in `utils/money.ts`, surfaced via `formatMoney` in
  `composables/useFormat.ts`) so grouped output is produced everywhere money is shown.
- Grouping is derived from the `Decimal` string value — the helper stays
  string-in / string-out and is **never** routed through a JS `number` or
  `Number.prototype.toFixed`.
- The fraction length continues to come from the currency's `decimal_places`
  (0, 2, 3, …), not a hardcoded `2`. A currency with `decimal_places = 0` groups the
  integer part with no decimal portion.
- The grouping/decimal separators follow the active locale, consistent with the
  existing locale-aware number formats (`la`, `en`).
- No backend, DTO, or persisted-value change: this is display formatting only.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-i18n`: the **Locale-Aware Formatting** requirement is tightened so that
  monetary amounts are rendered with locale-aware thousands grouping, while keeping
  the existing constraints — formatted to the currency's `decimal_places` and never
  carried or rendered as a JavaScript number.

## Impact

- Affected code: `front-end/src/utils/money.ts` (`formatAmount`),
  `front-end/src/composables/useFormat.ts` (`formatMoney`). All views that display
  money go through these helpers, so they pick up grouping automatically.
- No change to `back/`, the DBML, DTOs, or stored values.
- Invariants: upholds "money is never a JS number" and "format using the currency's
  `decimal_places`." Does not touch company isolation, append-only ledgers, derived
  balances, reserve/actual/release, FX, or permission checks.
- Tests: extend the front-end money-formatting unit tests for grouping across
  `decimal_places` of 0 / 2 / 3 and across locales.
