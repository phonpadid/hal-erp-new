## Context

The ERP already records everything needed for analytics — the append-only `budget_txn`
ledger, `approval_log`, `document`/`document_line` runtime data, `quota_usage`/
`quota_entitlement`, and locked-FX `base_total_amount`/`base_line_amount` — but exposes
no read path for aggregation. The `permission` table already reserves a `REPORT` module,
so reporting was always intended. This design adds a **read-only** layer: it computes
figures by summing the existing ledgers and never stores or mutates a derived value.

Stakeholders: CFO / finance (budget vs actual, spend), department heads (their scope),
procurement (vendor/item spend, 3-way match), HR (headcount; salary is sensitive),
group management (cross-company comparison, GROUP scope only).

## Goals / Non-Goals

**Goals:**
- A backend `reporting` module that serves a registry of named, parameterized reports as
  scope-aware, company-isolated DB aggregations, returning money as strings.
- A `web-dashboards` frontend rendering the catalog as KPI cards, charts, and drill-down
  tables, gated by `REPORT_*` permission codes.
- Honor every core invariant: company-first filtering, GROUP-only cross-company reads,
  budget figures derived from `budget_txn` (invariant 3), base amounts from locked FX
  columns (invariant 8), permission-code authorization (invariant 6).

**Non-Goals:**
- No new business data, no schema migration (only seeding `REPORT_*` permission rows).
- No writes of any kind — no `budget_txn`/`quota_usage`/`approval_log` rows are created,
  so there are **no budget/quota write flows, transaction boundaries, or locks** in this
  change. (Rule note: this capability performs zero ledger writes by design; the only DB
  access is read-only aggregation, so SELECT FOR UPDATE / `em.transactional()` for budget
  writes are intentionally out of scope.)
- No real-time streaming; reports are request/response snapshots.
- PDF export deferred; CSV/Excel only.

## Decisions

**1. Report registry over ad-hoc endpoints.** Each report is a `ReportDefinition`
(id, required permission code, default scope, parameter schema, query builder, result
shape). A single `GET /reports` lists the catalog the caller may see; `POST /reports/:id`
runs one with validated filters. *Alternative — one bespoke controller per report —*
rejected: it duplicates scope/filter/permission plumbing N times and drifts.

**2. Aggregate in the database, never in Node.** Reports use the MikroORM QueryBuilder /
raw SQL with `SUM`/`COUNT`/`GROUP BY` and return narrow projected rows, not hydrated
entities. Money columns are selected as text and carried as strings end-to-end; the client
formats by `currency.decimal_places`. *Alternative — load entities and reduce in JS —*
rejected: breaks on large ledgers and risks float money.

**3. Budget figures are always derived from `budget_txn`.** Every budget report computes
balance/utilization as `amount_total + ADJUST_INCREASE − ADJUST_DECREASE + TRANSFER_IN −
TRANSFER_OUT − RESERVE − ACTUAL + RELEASE` by summing the ledger (invariant 3). No report
reads a stored usage value; `budget.amount_total` is used only as the opening figure.

**4. Scope is a query predicate, resolved server-side.** The caller's role grants a scope
(OWN/DEPARTMENT/COMPANY/GROUP) for each `REPORT_*` code. The engine injects the matching
predicate: OWN → `created_by = me`; DEPARTMENT → `department_id IN (my dept subtree)`;
COMPANY → `company_id = active`; GROUP → companies the user belongs to, **read-only**, the
only path that crosses `company_id`. Every query filters company first, then scope
(invariant 1). The client guard is UX only; the server is authoritative.

**5. Base currency for cross-currency aggregation.** Any report that sums across documents
uses the locked `base_total_amount` / `base_line_amount` (invariant 8); currency-exposure
reports additionally group by the document `currency`. FX is never recomputed.

**6. Charts via PrimeVue `Chart` (Chart.js).** Bar/stacked/line/donut/pie/Pareto map to
native chart types; waterfall and heatmap are composed from bar/matrix datasets. Colors
come from PrimeUI theme tokens (no hardcoded hex) so light/dark both work. KPI cards and
drill-down tables use PrimeVue `Card`/`DataTable`. Filters use `@primevue/forms` + a Zod
schema shared with the backend filter DTO (single source of truth in `/shared`).

**7. Sensitive reports gated separately.** Salary-band/compensation reports require
`EMP_SALARY_VIEW` in addition to the report code; they are omitted from the catalog
response when the caller lacks it, not merely hidden client-side.

**8. Performance path.** Start with indexed live aggregation over existing indexes
(`budget_txn.budget_id`, `document(company_id, department_id, status)`, `approval_log.
document_id`). If a report exceeds budget under load, promote it to a scheduled
materialized rollup (read-only, rebuilt from the ledgers) without changing its API — the
registry shape is stable across that swap.

## Risks / Trade-offs

- **Aggregation cost on large ledgers** → Push all work to indexed SQL; paginate/limit
  drill-downs; reserve materialized rollups for the few heavy reports (decision 8). Log
  any row cap so truncation is never silent.
- **Cross-company leakage via GROUP scope** → GROUP is read-only and only spans companies
  the user is actually a member of; company-first predicate is applied in one shared place,
  not per report, and is covered by an isolation test (a COMPANY-scope caller never sees
  another company's rows).
- **Money precision** → Select DECIMAL as text; never coerce to JS number on either side;
  format by `decimal_places`.
- **Sensitive data exposure** → Salary reports require `EMP_SALARY_VIEW`; catalog filtering
  happens server-side.
- **Stale rollups (if introduced later)** → Stamp each materialized report with its build
  time and surface it in the UI; the live-query default has no staleness.
