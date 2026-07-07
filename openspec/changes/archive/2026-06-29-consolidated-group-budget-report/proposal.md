## Why

Slice A (`company-operational-reports`) gave managers four company-scoped reports. The remaining
Feature 11 report is the one for **Group executives**: a consolidated view that rolls every company's
budget balances up into a single presentation currency (รายงานรวมเครือ). Today there is no
cross-company report and no GROUP-scope reporting permission, even though the foundations exist —
`CompanyScopeService.forGroupRead()` for read-only cross-company access, the company→budget→ledger
derivation, and `ExchangeRateService.convert()` with a company-override→GROUP→inverse rate hierarchy.
This change adds the one Group report on top of those, completing Feature 11.

## What Changes

A new **consolidated group budget-balance report** added to the existing `reporting` capability:

- A `GET /reports/group/budget-balance` endpoint that, across **all active companies** (read-only,
  via `forGroupRead()`), derives each company's budget balances from `budget_txn` (the same derived
  formula as Slice A — never a stored value), and converts each company's base-currency totals into a
  **caller-chosen presentation currency** using the **GROUP exchange rate as of the report date**
  (company-override→GROUP→inverse, presentation only). The response carries per-company rows (with the
  source base currency, the resolved rate, and the converted amounts) and a **group total** in the
  presentation currency.
- A new permission **`REPORT_GROUP_VIEW`**, meaningful only at **GROUP scope**. The endpoint requires
  the code (guard) AND the service asserts it is held at GROUP scope (`ScopeService.isGroup`) before
  doing any cross-company read — so a company-level `REPORT_VIEW` never leaks other companies.
- The conversion is strictly **presentation-only**: it never writes a ledger row, never touches
  `budget.amount_total`, and never alters any document's locked FX (invariant 6). If no rate resolves
  for a company's base→presentation pair as of the date, that company is reported as **unconvertible**
  (its native total is still shown, excluded from the group total) rather than failing the whole report.
- A frontend Group report view (presentation-currency picker + as-of date), gated on
  `REPORT_GROUP_VIEW`, formatting each amount to its currency's `decimal_places`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `reporting`: adds a consolidated group budget-balance report (cross-company, converted to a chosen
  presentation currency at the GROUP rate as of the report date) gated by a new GROUP-scope
  `REPORT_GROUP_VIEW` permission.

## Impact

- Backend (`back/src/modules/reporting/`): a `GroupReportingService` (lists active companies via
  `forGroupRead()`, derives each company's budget balances reusing the Slice-A derivation inside a
  per-company `RequestContext.run`, converts via `ExchangeRateService.convert` with the GROUP rate),
  a `GET /reports/group/budget-balance` controller method, a `GroupBudgetBalanceQueryDto`
  (`currency`, `asOf?`), and the `REPORT_GROUP_VIEW` permission (added to the seed enumeration and
  granted at GROUP scope to the group-admin role). Imports `MultiCurrencyModule` (ExchangeRateService)
  and `RbacModule` (ScopeService).
- Frontend: a Group report view + a `reports.group*` api/store method + a nav/route gated on
  `REPORT_GROUP_VIEW`; reuses currency formatting.
- Reuses unchanged: `BudgetBalanceService`, `CompanyScopeService.forGroupRead()`,
  `ExchangeRateService`, `ScopeService`.
- Invariants: company isolation is *intentionally and explicitly* widened only for this read-only
  GROUP report (guarded by GROUP-scope `REPORT_GROUP_VIEW`); append-only ledgers and locked FX are
  untouched; balances stay derived. Inter-company transfers remain forbidden — this only *reports*.
