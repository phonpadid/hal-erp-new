## Why

The data model already answers the operational questions managers ask daily — real-time budget
balances, where approvals are stuck, who has quota left, and the full budget audit trail — but
there is no reporting surface that aggregates and presents them. Every balance/aging/usage primitive
exists as a per-entity service (`BudgetBalanceService.breakdown()/ledger()`,
`ApprovalInboxService.pending()` + `SlaService`, `QuotaBalanceService.breakdown()/remaining()`), yet
a manager must open one budget, one quota, one document at a time. There is no "all departments",
"all pending across approvers", or "all employees" view. This change adds a thin, read-only
reporting layer over those existing services so the structure can answer these questions at a glance.

Scope is the **four company-scoped reports**. The fifth report (consolidated GROUP across companies)
is a separate follow-on slice because it needs new GROUP-scope permissions and a presentation-
currency path; its design is pre-agreed (caller picks the presentation currency; convert each
company base using the GROUP rate as of the report date) and recorded here for continuity.

## What Changes

A new read-only `reporting` capability with four reports, each a thin aggregation over existing
services (no new ledger math, no new write paths):

1. **Budget balance by department / category** — aggregates `BudgetBalanceService.breakdown()` across
   the active company's budgets, grouped by department and GL account (category), each row showing
   amount_total, adjustments, transfers, reserved, actual, released, and available — all in the
   company base currency, always derived from `budget_txn`, never stored.
2. **Pending-approval aging / bottlenecks** — lists documents currently `IN_APPROVAL` with the step
   they are stuck on, the resolved eligible approver(s), document age (since submit) and time-in-step
   (since the step was entered, from `approval_log`), and SLA/overdue status; groupable by
   approver and by step so the bottleneck is visible.
3. **Per-person quota remaining** — lists each quota's per-employee entitlement and remaining
   (e.g. leave days left) via `QuotaBalanceService.breakdown()`, for the active company and a chosen
   period/year.
4. **Budget movement audit trail** — a chronological, company-wide list of `budget_txn` entries with
   their txn type, amount, timestamp, and the originating document (`doc_no`, linked), filterable by
   budget/department and date range, for audit.

- New permission code `REPORT_VIEW` gates the report endpoints (read-only); company scope is applied
  on every query exactly like the underlying resources.
- New frontend report views (under a Reports section) with filters and export-friendly tables; money
  formatted to the currency's `decimal_places`; never a JS number.
- No schema/migration change, no new ledger writes, no change to any existing service's behaviour —
  reports only read and aggregate.

## Capabilities

### New Capabilities

- `reporting`: read-only operational reports over existing budget/approval/quota ledgers — budget
  balance by department/category, pending-approval aging/bottlenecks, per-person quota remaining,
  and the budget movement audit trail; company-scoped and gated by `REPORT_VIEW`.

### Modified Capabilities

(none — additive)

## Impact

- Backend: a new `reporting` module — `ReportingService` (aggregations that call the existing
  balance/inbox/quota/ledger services), `ReportingController` (`GET /reports/budget-balance`,
  `/reports/approval-aging`, `/reports/quota-remaining`, `/reports/budget-audit`), DTOs for filters,
  and a `REPORT_VIEW` permission. Concurrency-safe by construction (read-only, derived).
- Frontend: new report views + a small `reports` api/store + a Reports nav entry, gated on
  `REPORT_VIEW`; reuses currency formatting and pagination conventions.
- Reuses (no change): `BudgetBalanceService`, `ApprovalInboxService`, `ApproverResolverService`,
  `SlaService`, `QuotaBalanceService`, `CompanyScopeService`.
- Invariants honoured: company isolation (every query scoped to the active company), append-only
  ledgers (reports read, never write), derived balances (computed fresh, never cached/stored), locked
  FX untouched (these reports are single-currency, company base).
- Out of scope (Slice B): the consolidated GROUP report, GROUP-scope report permissions, and any
  cross-company currency conversion.
