## Context

The budget detail screen (`front-end/src/views/budgets/BudgetDetailView.vue`)
already renders the derived balance breakdown as a numeric list in a
`SectionCard`, built from `budgets.breakdown` (the budget breakdown payload:
`amountTotal`, `adjustIncrease`, `adjustDecrease`, `transferIn`, `transferOut`,
`reserved`, `actual`, `released`, `available`). Those figures are already derived
server-side from the append-only `budget_txn` ledger (invariant 3) and arrive as
DECIMAL strings. The screen formats them with `formatAmount(value, decimals)`
using the company base currency's `decimalPlaces`.

`chart.js ^4.5.1` is already a dependency but not yet used anywhere. PrimeVue 4
ships a `Chart` wrapper component over Chart.js. This change adds a single
presentational waterfall view of the existing breakdown — no backend, no API, no
schema, no ledger writes.

## Goals / Non-Goals

**Goals:**
- Add a floating-bars waterfall to the budget detail page that visualizes the
  journey from `amountTotal` to `available`, reusing the breakdown data already
  loaded.
- Keep the existing numeric breakdown as the exact, accessible source of truth;
  the chart sits alongside it.
- Format every charted amount to the currency `decimal_places`; parse DECIMAL
  strings to numbers only for chart geometry, never for display or wire transfer.
- Use PrimeUI theme tokens so increase/decrease colors and gridlines work in both
  light and dark mode.

**Non-Goals:**
- No new reporting endpoint or aggregation (that is the separate
  `reporting-and-dashboards` change). This reuses the per-budget breakdown only.
- No time-series burn-down, no cross-budget comparison, no export.
- No backend or `budget_txn` changes. This change writes no ledger rows.

## Decisions

**No budget_txn or quota_usage writes.** This is a read-only presentational
change. There is no DB transaction boundary, no locking, and no ledger sequence
note to add — the waterfall consumes the already-derived breakdown payload and
never reserves, actuals, releases, or otherwise mutates budget state. All
invariants about append-only ledgers and locking are unaffected.

**Waterfall via floating bars on Chart.js bar type.** Chart.js renders a
floating/“range” bar when a dataset point is a `[start, end]` tuple. We compute a
running balance and emit one `[prevRunning, newRunning]` bar per component, in the
exact derivation order `total + adjustIncrease − adjustDecrease + transferIn −
transferOut − reserved − actual + released`. The first bar (`amountTotal`) floats
from 0 to the total; the final `available` bar is grounded `[0, available]` to
read as the result. Alternative considered: a stacked bar with transparent
spacers — rejected as more fragile and harder to tooltip than native float bars.

**Reuse the existing `rows` ordering.** `BudgetDetailView.vue` already builds an
ordered `rows` array with a `sign` per component; the waterfall derives its steps
from the same order and signs so the numeric list and the chart can never drift.
The running-balance reduction lives next to (or replaces) that computed property.

**Decimal handling.** Money stays a string end-to-end. We parse each component to
a Number only inside the chart-data builder to compute bar geometry, and format
ticks/tooltips back through `formatAmount(value, currencyDecimals)`. No money
value is bound to a component as a JS number for display, and nothing new crosses
the wire.

**Theming.** Increase steps, decrease steps, and the final available bar take
their colors from PrimeUI CSS theme tokens (e.g. semantic success/danger/primary
token variables resolved at runtime), not hardcoded hex, so the chart follows the
Aura preset and the `.dark` selector automatically.

**Component shape.** A focused `BudgetWaterfallChart.vue` under
`front-end/src/views/budgets/` takes the breakdown object and `currencyDecimals`
as props and renders the PrimeVue `Chart`. `BudgetDetailView.vue` mounts it in a
`SectionCard` above or beside the existing numeric breakdown, behind the same
`v-can="'BUDGET_VIEW'"` gating already governing the page.

## Risks / Trade-offs

- [Chart.js not previously used in the app] → Register only the needed bar
  controller/elements/scales (or use PrimeVue `Chart`, which handles registration)
  and keep the component self-contained so the new dependency surface is minimal.
- [Reading theme tokens for colors] → Resolve PrimeUI token CSS variables at
  render and re-resolve on theme toggle so dark mode stays correct; fall back to
  token-based defaults rather than hardcoded hex.
- [Numeric breakdown and chart could drift] → Both derive from the same ordered
  component list and signs; a unit test asserts the final waterfall running total
  equals `available` for representative figures.
- [Floating-point display error from parsing DECIMAL strings] → Numbers are used
  only for pixel geometry; all displayed/tooltip amounts are formatted from the
  original strings via `formatAmount`, so no rounding reaches the user.
