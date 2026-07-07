## Context

Money is displayed through two shared front-end helpers:
`formatAmount(value, decimalPlaces)` in `front-end/src/utils/money.ts`, which does
`new Decimal(value || '0').toFixed(decimalPlaces)`, and `formatMoney(value, decimalPlaces)`
in `front-end/src/composables/useFormat.ts`, which delegates to it. Both keep amounts
as decimal strings and honor the currency's `decimal_places`, satisfying the money
invariants. Neither adds thousands separators, so `1000000.00` renders ungrouped.

The original request was a `formatNumber(n)` helper using `n.toFixed(2)` plus a regex.
That takes a JS `number` and hardcodes 2 decimals, which violates two invariants
(money is never a JS number; format to the currency's `decimal_places`). This design
delivers the same grouped output without those violations.

## Goals / Non-Goals

**Goals:**
- Render monetary amounts with thousands grouping (e.g. `1,000,000.00`).
- Keep the helper string-in / string-out, deriving grouping from the `Decimal` value.
- Preserve currency-driven fraction length (`decimal_places` of 0 / 2 / 3 …).
- Use locale-appropriate grouping and decimal separators, consistent with the
  existing `la` / `en` number formats.
- All money screens inherit grouping automatically by going through the shared helpers.

**Non-Goals:**
- No backend, DTO, DBML, or stored-value change.
- No currency-symbol or accounting-style (parentheses) formatting.
- No change to date or plain-count formatting.

## Decisions

**1. Group from the Decimal string, not a JS number.**
Compute the fixed-precision string with `new Decimal(value || '0').toFixed(places)`
(unchanged), then split on `.` and insert group separators into the integer part only.
The fractional part is left untouched. This never constructs a JS `number` from the
amount, so precision is never at risk for large values.
- *Alternative considered:* the requested `n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")`
  — rejected because it coerces to `number` and hardcodes 2 decimals.
- *Alternative considered:* `Intl.NumberFormat`/vue-i18n `$n` — these take a JS `number`
  and would lose precision on large/high-precision amounts, so they are not used for money
  (they remain correct for plain counts, which is what `numberFormats` already covers).

**2. Separators come from the active locale.**
Resolve the grouping and decimal separators for the active locale (e.g. via
`Intl.NumberFormat(locale).formatToParts(11111.1)`) and apply them to the
already-computed Decimal string, rather than assuming `,` and `.`. The numeric
content still originates entirely from `Decimal`. Default to `en`-style `,`/`.` when a
locale lookup is unavailable so the helper stays pure and synchronous.

**3. Negative amounts keep a leading sign**; grouping applies to the digits after the
sign. Zero with `decimal_places = 0` renders as `0` (no separators, no fraction).

**4. Single point of change.** Only `formatAmount` gains grouping; `formatMoney`
keeps delegating to it, so every view already calling these helpers is updated with
no per-view edits.

## Risks / Trade-offs

- [Separator drift between locales and the rest of the UI] → Source separators from the
  same active locale the app already uses for `$d`/`$n`, and cover `la` and `en` in tests.
- [A view formats money without the shared helper] → Out of scope to find them all here,
  but the existing web-i18n requirement already forbids ad-hoc money formatting; add a
  test asserting grouped output from the shared helper to anchor the contract.
- [Performance of per-call separator lookup] → Negligible at table scale; if needed,
  memoize the resolved separators per locale.

## Migration Plan

Pure additive display change. Deploy the helper update; no data migration, no flag.
Rollback is reverting the helper — output returns to ungrouped strings with no data
impact.

## Open Questions

None. (No `budget_txn` / `quota_usage` writes are involved — this is display-only, so no
DB transaction boundary or locking applies.)
