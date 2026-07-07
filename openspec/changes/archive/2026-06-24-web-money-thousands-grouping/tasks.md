## 1. Money helper grouping

- [x] 1.1 In `front-end/src/utils/money.ts`, extend `formatAmount(value, decimalPlaces)` to insert
  thousands grouping into the integer part of the `Decimal(value).toFixed(decimalPlaces)` string,
  keeping it string-in / string-out and never coercing to a JS `number`.
- [x] 1.2 Handle edge cases: negative amounts keep the leading sign; `decimalPlaces = 0` yields a
  grouped integer with no decimal separator; `0` renders correctly at each precision.
- [x] 1.3 Source the grouping and decimal separators from the active locale (e.g. via
  `Intl.NumberFormat(locale).formatToParts`), defaulting to `,` / `.` when no locale is resolvable;
  apply them to the Decimal-derived string only.

## 2. Wire-through

- [x] 2.1 Confirm `formatMoney` in `front-end/src/composables/useFormat.ts` still delegates to
  `formatAmount` so all money views inherit grouping with no per-view edits.
- [x] 2.2 Spot-check a money-rendering view (e.g. budget list / balance breakdown) shows grouped
  output for a large amount.

## 3. Tests

- [x] 3.1 Add/extend front-end unit tests for `formatAmount`: grouping at `decimal_places` 0 / 2 / 3,
  large values (`1000000.00` → `1,000,000.00`), negatives, and zero.
- [x] 3.2 Add a locale test asserting grouping/decimal separators follow the active locale
  (`la` and `en`).
- [x] 3.3 Add a test asserting the amount is never converted to a JS number (precision preserved for
  a value beyond `Number.MAX_SAFE_INTEGER`).
