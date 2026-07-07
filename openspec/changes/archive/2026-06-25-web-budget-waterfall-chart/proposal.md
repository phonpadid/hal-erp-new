## Why

The budget detail screen already lists the derived balance components (total,
adjustments, transfers, reserved, actual, released → available) as a plain
number column. That reconciliation is correct but hard to *read*: a viewer
cannot see at a glance how a budget travelled from its original total down to
what is still available, or which movement consumed the most. A floating-bars
waterfall ("งบเดินทางมายังไง" — *how the budget got here*) turns the existing
append-only ledger derivation into a single visual story, on the data the
breakdown endpoint already returns.

## What Changes

- Add a **floating-bars waterfall chart** to the budget detail page
  (`web-budgets` Budget Balance Breakdown), rendering the running balance from
  `amountTotal` through each component to `available`. Each bar floats between
  the prior running total and the new running total; increases and decreases are
  visually distinct, and the final `available` bar is grounded at zero as the
  result.
- The chart is **derived, presentational, and read-only** — it consumes the same
  breakdown figures already shown in the numeric list (no new endpoint, no new
  stored value). The existing numeric breakdown stays as the accessible,
  exact-figure source of truth alongside the chart.
- Money is formatted to the company base currency's `decimal_places` in axis
  ticks and tooltips, and figures are parsed from the DECIMAL strings only for
  charting geometry — they continue to cross the wire and render as strings,
  never as a JS number for display.
- The chart is gated by the same `BUDGET_VIEW` permission and active-company
  context as the rest of the page (client-side UX only; the server stays
  authoritative).

## Capabilities

### New Capabilities
<!-- None. This reuses the existing breakdown data and adds a presentational requirement. -->

### Modified Capabilities
- `web-budgets`: adds a requirement that the Budget Balance Breakdown also be
  presented as a floating-bars waterfall of the same derived components, honoring
  currency decimal places and reconciling to the available balance. No change to
  what is computed — only an additional view of it.

## Impact

- **Code (frontend only):** new waterfall chart component under
  `front-end/src/views/budgets/` (or a shared chart component) used by
  `BudgetDetailView.vue`; rendered with the already-bundled `chart.js ^4.5.1`
  via PrimeVue 4 `Chart`. New i18n keys for the chart title, legend, and the
  running-balance/available labels.
- **Data / API:** none. Reuses the existing budget breakdown payload
  (`amountTotal`, `adjustIncrease`, `adjustDecrease`, `transferIn`,
  `transferOut`, `reserved`, `actual`, `released`, `available`).
- **Backend:** none.
- **Invariants honored:** (3) figures remain derived from the breakdown
  (never from a stored usage value), the waterfall geometry sums in the exact
  order total + adjust ± transfer − reserved − actual + released = available;
  money is formatted to currency `decimal_places` and never carried as a JS
  number on the wire. No company-isolation surface changes (read-only,
  active-company scoped).
- **Risk:** low — additive, presentational, no schema or service changes.
