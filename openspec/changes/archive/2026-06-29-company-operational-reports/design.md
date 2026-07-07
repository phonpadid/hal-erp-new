## Context

The audit confirmed every numeric primitive already exists and is correct; what's missing is an
aggregation/presentation layer. Reusable building blocks:

- `BudgetBalanceService.breakdown(budgetId)` → `{amountTotal, adjustIncrease, adjustDecrease,
  transferIn, transferOut, reserved, actual, released, available}`; `.ledger(budgetId)` →
  chronological `budget_txn` entries with resolved `documentNo`. Budgets link Department and
  `glAccount` (category); company via FiscalYear→Company.
- `ApprovalInboxService.pending()` → documents `IN_APPROVAL` with `currentStepNo`, `submittedAt`,
  `slaDueAt`, `overdue` (but eligibility-filtered to the caller). `ApproverResolverService.eligible
  (step, document)` → the actors a step is waiting on. `SlaService.currentStepSla(documentId)` →
  `{currentStepNo, slaDueAt, overdue}` (weekend/holiday-aware). `approval_log` rows carry `stepNo`,
  `action`, `actedAt` — the last APPROVE before the current step gives "entered-step-at".
- `QuotaBalanceService.breakdown(quotaId, period)` → per-employee `{employee, entitled, used,
  remaining}`; `.remaining(quotaId, {employeeId, year, period})`.
- `CompanyScopeService.forActiveCompany()` applies the company filter; reports use it directly.

## Goals / Non-Goals

**Goals:**
- Four read-only, company-scoped report endpoints + views that aggregate the above across the active
  company, gated by a new `REPORT_VIEW` permission.
- Reports compute fresh on each request (derived balances, never cached/stored) and never write.
- Surface the approval bottleneck: for each pending document, which step + which eligible approver(s)
  it waits on, document age, and time-in-step; groupable by approver and by step.

**Non-Goals:**
- No consolidated/GROUP cross-company report (Slice B), no GROUP-scope permission, no FX in these
  reports (all amounts are company base currency, single currency).
- No new ledger types, no schema/migration, no change to existing service behaviour.
- No materialized views / caching layer; if performance ever needs it, that's a later optimization.
- No scheduled/emailed reports; on-demand reads only.

## Decisions

1. **One `ReportingService` that orchestrates existing services — it owns no balance math.** Each
   report method loads the relevant rows under `forActiveCompany()` and folds the existing
   per-entity services over them. This keeps the single source of truth in the balance/quota
   services and guarantees the report and the detail screens never disagree.

2. **Budget-balance report aggregates per-budget breakdowns, grouped by (department, glAccount).**
   List the company's budgets (optionally filtered by fiscal year / department), call `breakdown()`
   for each, and sum the components into rows keyed by department + category. Output carries both the
   per-budget rows and the grouped subtotals so the UI can drill down. All values are company base
   currency strings (Money), formatted client-side by `decimal_places`.

3. **Approval-aging report is NOT eligibility-filtered.** `ApprovalInboxService.pending()` only
   returns what the *caller* can act on — wrong for a bottleneck report. The reporting query instead
   loads all `IN_APPROVAL` documents in the active company and, for each, resolves the current step
   and its eligible approver(s) via `ApproverResolverService.eligible()`, computes document age
   (`now − submittedAt`) and time-in-step (`now − enteredStepAt`, where `enteredStepAt` is the latest
   `approval_log.actedAt` with a lower/equal step, falling back to `submittedAt`), and SLA/overdue via
   `SlaService`. The endpoint returns the flat list plus two roll-ups: by approver and by step. This
   is read-only and respects no-self-approval only in the sense of *display* — it shows the true
   waiting set, not the caller's actionable set.

4. **Quota-remaining report folds `breakdown()` across the company's quotas for a chosen year/period.**
   Rows are (quota, employee, entitled, used, remaining). Period/year default to the current cycle;
   the caller may pass them. Reuses the existing period handling, no new logic.

5. **Budget-audit report is the company-wide `budget_txn` stream.** Rather than per-budget `ledger()`
   calls, the report queries `budget_txn` joined to its budget (scoped to the active company through
   Budget→FiscalYear→Company) and to its source `document` for `doc_no`, ordered by `createdAt DESC`,
   filterable by budget/department and a date range. Each row: txnType, amount, createdAt, documentNo
   (linked), remark, who. Append-only means corrections appear as their own rows — correct for audit.

6. **`REPORT_VIEW` is a new permission, company-scoped.** Every endpoint requires it and applies
   `forActiveCompany()`. We deliberately use one report-view code rather than per-report codes to keep
   the surface small; finer gating can come later. (A user who can see a report sees the company's
   aggregate even for departments they don't own — acceptable for a manager report behind
   `REPORT_VIEW`; revisit if department-level confidentiality is required.)

7. **Frontend: a Reports section with one view per report.** Filter controls (fiscal year /
   department / date range / period), PrimeVue DataTables, money via the currency-format composable,
   permission-gated nav by `REPORT_VIEW`. A small `reports` api + Pinia store mirrors the existing
   resource stores.

## Risks / Trade-offs

- **N+1 over budgets/documents.** Aggregating `breakdown()`/`eligible()` per row is O(n) service
  calls. For realistic company sizes this is fine; the audit's `ledger()` already bulk-resolves doc
  numbers, and the budget-audit report uses a single joined query. If a company has thousands of
  budgets, a later optimization can push the fold into SQL — explicitly out of scope now, and noted
  so it isn't mistaken for "covered".
- **Time-in-step approximation.** Without an explicit "step entered" timestamp, we derive it from
  `approval_log`. For the first step (no prior action) it equals `submittedAt`. Parallel steps and
  returns make this an approximation; we document it as "time since last action at/below this step,"
  which is the meaningful bottleneck signal, not a billing-grade SLA clock.
- **Department confidentiality.** `REPORT_VIEW` exposes company-wide aggregates. If some managers
  must see only their department, that's a future scope refinement; flagged, not silently assumed.
- **Consistency with detail screens.** Because reports reuse the same services, a report and the
  budget/quota detail will always agree — the main reason we orchestrate rather than re-query.
