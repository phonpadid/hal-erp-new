## 1. Reporting module scaffold + permission

- [x] 1.1 Create `back/src/modules/reporting/` with `ReportingModule` (imports Budget, Approval,
      Quota, Currency, Multi-company modules to reuse their services), `ReportingService`,
      `ReportingController`, and `permissions.ts` defining `REPORT_VIEW`.
- [x] 1.2 Register `REPORT_VIEW` wherever permission codes are seeded/enumerated; guard every report
      endpoint with `@RequirePermissions(REPORT_VIEW)`.
- [x] 1.3 Wire `ReportingModule` into the app module.

## 2. Budget balance by department / category

- [x] 2.1 `ReportingService.budgetBalanceByDeptCategory(filter)` — load the active company's budgets
      (optional fiscalYear/department filter) via `forActiveCompany()`, call
      `BudgetBalanceService.breakdown()` per budget, and aggregate component subtotals into rows keyed
      by (department, glAccount); return per-budget rows + grouped subtotals, all base-currency strings.
- [x] 2.2 `GET /reports/budget-balance` with a filter DTO (fiscalYearId?, departmentId?); company-scoped.
- [x] 2.3 Unit test: grouping sums correctly; a freshly appended `budget_txn` row changes the derived
      available (no stored value); department filter narrows the set.

## 3. Pending-approval aging / bottlenecks

- [x] 3.1 `ReportingService.approvalAging()` — load ALL `IN_APPROVAL` documents in the active company
      (NOT eligibility-filtered); for each resolve current step + eligible approver(s) via
      `ApproverResolverService.eligible()`, compute document age and time-in-step (latest
      `approval_log.actedAt` at/below the current step, else `submittedAt`), and SLA/overdue via
      `SlaService`.
- [x] 3.2 Add by-approver and by-step roll-ups (pending count + oldest age) to the response.
- [x] 3.3 `GET /reports/approval-aging`; company-scoped, `REPORT_VIEW`.
- [x] 3.4 Unit test: a document pending on someone other than the caller still appears; roll-ups group
      correctly; overdue uses the working-time calendar (weekend/holiday not counted).

## 4. Per-person quota remaining

- [x] 4.1 `ReportingService.quotaRemaining(filter)` — for the active company's quotas and a chosen
      year/period (default current), fold `QuotaBalanceService.breakdown()` into (quota, employee,
      entitled, used, remaining) rows.
- [x] 4.2 `GET /reports/quota-remaining` with a filter DTO (year?, period?); company-scoped.
- [x] 4.3 Unit test: remaining = entitlement − net usage for the period; period override changes the result.

## 5. Budget movement audit trail

- [x] 5.1 `ReportingService.budgetAudit(filter)` — query `budget_txn` joined to its budget (scoped via
      Budget→FiscalYear→Company to the active company) and to its source `document` for `doc_no`,
      ordered `createdAt DESC`, filterable by budget/department and date range; return txnType, amount,
      createdAt, documentId/documentNo, remark, actor.
- [x] 5.2 `GET /reports/budget-audit` with a filter DTO (budgetId?, departmentId?, from?, to?); company-scoped.
- [x] 5.3 Unit test: rows carry the originating document number; date/budget filters narrow correctly;
      a correcting row and its original both appear (append-only, nothing merged).

## 6. Frontend report views

- [x] 6.1 `front-end/src/api/reports.ts` + a `reports` Pinia store for the four endpoints.
- [x] 6.2 A Reports section with four views (budget balance, approval aging, quota remaining, budget
      audit), each with its filter controls + a PrimeVue DataTable; money via the currency-format
      composable (decimal_places); document links navigate to the document detail.
- [x] 6.3 Add a Reports nav entry gated on `REPORT_VIEW`; mirror the show/hide-by-permission pattern.

## 7. Verification

- [x] 7.1 Backend: `nest build` clean; the reporting unit tests pass; existing suite stays green.
- [x] 7.2 Frontend: `vue-tsc` clean; i18n labels added (en + la) for the four reports and their filters.
- [x] 7.3 Confirm invariants: every report query is company-scoped; no report writes a ledger row;
      balances are derived not stored. (Note any remaining N+1 as a documented future optimization,
      not a defect.)
