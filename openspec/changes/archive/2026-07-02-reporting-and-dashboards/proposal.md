## Why

The system already captures rich, audit-grade data — an append-only budget ledger,
an approval log, runtime documents with line items, quota usage, and locked-FX
multi-currency amounts — but has no way to *read it back as insight*. The `permission`
module already anticipates a `REPORT` module, yet no reporting capability is specified.
Decision-makers (CFO, dept heads, procurement) currently cannot answer basic questions:
*Are we over budget? Where is spend going? Why are approvals slow?* This change adds a
read-only reporting engine and a charting dashboard on top of the existing data — no new
business data, only aggregation of what the ledgers already record.

## What Changes

This proposal also answers the user's question — *what reports and charts can this
system produce?* — by deriving the feasible report set directly from the 37-table model.

- **New read-only reporting API** — parameterized aggregation endpoints (filters: company,
  fiscal year, department, document type, date range, currency) returning DECIMAL money as
  strings. All reports are computed by DB-side aggregation, never by mutating or storing
  derived values.
- **New dashboard/charts frontend** — PrimeVue 4 `Chart` (Chart.js) visualizations plus
  KPI cards and data tables, gated by `REPORT_*` permission codes and respecting
  OWN/DEPARTMENT/COMPANY/GROUP scope.
- **Report catalog** grouped by domain, all sourced from existing tables:
  - **Budget**: Budget vs Actual (bar), utilization % by department (heatmap/progress),
    balance breakdown (waterfall: total + adjust ± transfer − reserve − actual + release),
    burn-down over the fiscal calendar (line), over-/near-limit alerts (KPI + table),
    transfers & adjustments (table + Sankey). *Always derived from `budget_txn`, never
    `budget.amount_total`.*
  - **Quota**: utilization by type/department (bar/progress), per-employee leave balance
    (table from `quota_entitlement` − `quota_usage`), usage trend per reset cycle (line).
  - **Documents & approvals**: volume by type/category/status/period (stacked bar, trend
    line), status mix (donut), approval cycle time vs `sla_hours` (KPI + bar), pending-
    approval aging buckets (table + bar), approver workload & throughput (`approval_log`,
    bar), reject/return rate (KPI), delegation usage (table).
  - **Procurement / spend**: spend by vendor (Pareto), by item/category (treemap/bar),
    PR→PO open-line / 3-way-match status (table from `document_line`), top departments.
  - **Multi-currency**: exposure by currency (donut, document vs base totals), FX rate
    history (line from `exchange_rate`).
  - **HR (sensitive)**: headcount by department/status (bar), salary-band distribution
    (histogram) — gated behind `EMP_SALARY_VIEW`.
  - **Group view**: cross-company budget/spend comparison (grouped bar), GROUP scope only,
    strictly read-only.
- **Optional export** of any report as CSV/Excel (PDF deferred), scope-gated.

## Capabilities

### New Capabilities
- `reporting`: Backend read-only reporting engine — a registry of report definitions,
  scope-aware company-isolated aggregation queries over the existing ledgers/runtime
  tables, shared filter/pagination DTOs, money-as-string output, and `REPORT_*` permission
  enforcement. Includes optional CSV/Excel export.
- `web-dashboards`: Vue 3 + PrimeVue dashboard and report screens — KPI cards, charts
  (bar/line/donut/pie/waterfall/heatmap/Pareto), drill-down tables, and filter controls.
  Visibility driven by permission code and active-company context (client UX only; server
  remains authoritative).

### Modified Capabilities
<!-- No existing requirement changes. Reporting reads existing data; it adds no behavior to
     budget-control, approval-workflow, etc. New REPORT_* permission codes are seeded as
     master data under the existing rbac model without changing rbac requirements. -->

## Impact

- **Code**: new `reporting` NestJS module (controllers, report-definition services, query
  builders, export); new `web-dashboards` Vue views, chart components, Pinia report state,
  typed report API client; shared report filter Zod/DTO schemas in `/shared`.
- **Data**: read-only. No schema migration required. New `REPORT_*` rows seeded into the
  existing `permission` table (module = `REPORT`).
- **Invariants honored**: (1) every query filters `company_id` first, then scope — GROUP
  scope is the only cross-company path and is read-only; (3) budget figures are always
  derived by summing `budget_txn`, never read from a stored usage value; (8) all
  base-currency figures use the document's locked `base_total_amount`/`base_line_amount`.
- **Risk**: aggregation performance on large ledgers — addressed in design (indexed
  aggregation, optional materialized rollups). Sensitive data (salary) must stay behind its
  dedicated permission code.
- **Dependencies**: builds on multi-company, rbac, budget-control, quota-management,
  document-engine, approval-workflow, multi-currency (all upstream in the build order).
