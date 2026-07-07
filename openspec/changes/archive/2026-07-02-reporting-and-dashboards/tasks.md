# Reconciled scope (build on existing reporting)

This change was authored assuming a from-scratch reporting engine, but a working, tested
reporting capability already exists (5 bespoke endpoints under `REPORT_VIEW`/`REPORT_GROUP_VIEW`,
money-as-string, base-currency aggregation, budget figures derived from `budget_txn`, company
isolation, shared `ScopeService`, frontend report tables + theme-aware Chart.js pattern, i18n).

Per the reconcile decision we **keep** the existing bespoke endpoints and the `REPORT_VIEW` /
`REPORT_GROUP_VIEW` permission model, and **do not** introduce the registry pattern
(`GET /reports` catalog + `POST /reports/:id`) or the 6 granular `REPORT_*_VIEW` codes.
Already-satisfied requirements are marked `[x] (existing)`.

## 0. Already satisfied by existing code (no work)

- [x] (existing) Read-only aggregation; running a report writes no ledger row
- [x] (existing) Company isolation + GROUP-scope gate via `ScopeService`
- [x] (existing) Budget figures derived from `budget_txn`; base-currency + locked FX
- [x] (existing) Money as decimal string end-to-end; shared filter DTOs
- [x] (existing) Frontend money formatting by `decimal_places` (`money.ts`, `useCurrencyFormat`)
- [x] (existing) Theme-aware Chart.js pattern (`BudgetWaterfallChart.vue`)

## 1. Backend — new reports (bespoke, `REPORT_VIEW`, active-company scoped)

- [x] 1.1 `documentSummary(f)` + `GET /reports/document-summary`: count and base-amount totals grouped by document type {code,name,category} × status, plus overall status totals; filters from/to (createdAt), documentTypeId. Money via `Money` helper (string).
- [x] 1.2 `spendByVendor(f)` + `GET /reports/spend-by-vendor`: SUM `base_total_amount` grouped by vendor for documents in {APPROVED, COMPLETED}, sorted desc, with cumulative share for Pareto; filters from/to.
- [x] 1.3 `budgetUtilization(f)` + `GET /reports/budget-utilization`: per-department utilization % = (reserved+actual)/amountTotal, derived from the existing `budgetBalanceByDeptCategory` groups (no new ledger math); filter fiscalYearId.
- [x] 1.4 Add DTOs (`DocumentSummaryQueryDto`, `SpendByVendorQueryDto`) with class-validator; register endpoints on `ReportingController` under `REPORT_VIEW`.

## 2. Backend — CSV export

- [x] 2.1 Reusable `toCsv(columns, rows)` serializer (no new dependency) with proper quoting; money stays a string.
- [x] 2.2 Export endpoints reusing each report's method, permission code, scope, and filters — `GET /reports/{budget-audit,quota-remaining,document-summary,spend-by-vendor}/export` returning `text/csv` with `Content-Disposition`.

## 3. Frontend — chart layer

- [x] 3.1 Extract the theme-token color + dark-mode `MutationObserver` logic from `BudgetWaterfallChart` into a `useChartTheme` composable (cssVar resolver + reactive theme tick + a token palette).
- [x] 3.2 Reusable chart components over PrimeVue `Chart` using the composable + `useCurrencyFormat`: `BarChart`, `DonutChart`, `ParetoChart` (bar+line combo). Theme tokens only, no hardcoded hex.

## 4. Frontend — wire new + existing reports

- [x] 4.1 Add `documentSummary`, `spendByVendor`, `budgetUtilization` (+ export URLs) to `api/reports.ts` and loaders to `stores/reports.ts`.
- [x] 4.2 New report views: `DocumentSummaryReport.vue` (stacked bar by type + status donut + table), `SpendByVendorReport.vue` (Pareto + table), `BudgetUtilizationReport.vue` (bar by department + table); add as tabs in `ReportsView.vue`.
- [x] 4.3 Add a chart to the existing budget-balance report (available vs actual by department, bar) and approval-aging (pending count by step, bar), above their tables.
- [x] 4.4 CSV export button on the tabular report views (budget-audit, quota-remaining, document-summary, spend-by-vendor) that downloads with the current filters applied.
- [x] 4.5 i18n: add `reports.tabs.*` + per-report keys (labels, chart titles, columns, export) to `en/reports.ts` and `la/reports.ts` (keep parity).

## 5. Tests

- [x] 5.1 Backend: `documentSummary` counts/sums by type×status and does not leak another company's documents; `spendByVendor` sums locked `base_total_amount` and orders desc; `budgetUtilization` reconciles to the budget-balance groups.
- [x] 5.2 Backend: CSV export honors permission/scope/filters and emits money as string (incl. a 0-row filter).
- [x] 5.3 Frontend: new report views mount (smoke), i18n parity for new keys, and money formatting on a 0-decimal currency.
