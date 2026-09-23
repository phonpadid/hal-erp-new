## 1. Backend — the shared computation

- [x] 1.1 Make `DocumentService.visibleWhere` reachable as a public `visibleDocumentsWhere(em)`
      (same body; the private name stays as an alias for its current callers)
- [x] 1.2 Create `approval/pending-summary.service.ts` with `rowsFor(docs)`: per document the
      route step, eligible actors (resolver), approver names, `enteredStepAt`, `slaDueAt`,
      `overdue` — the computation lifted from `ReportingService.approvalAging`
- [x] 1.3 Refactor `ReportingService.approvalAging` to call `rowsFor` and map to its existing
      `ApprovalAgingRow` shape; existing aging specs still pass unchanged

## 2. Backend — the summary and its export

- [x] 2.1 `PendingSummaryQueryDto` (`departmentId`, `documentTypeId` UUIDs; `submittedFrom`,
      `submittedTo` date strings; `overdueOnly` boolean with transform) in `approval/dto`
- [x] 2.2 `PendingSummaryService.summary(q)`: scoped `IN_APPROVAL` set on the company EM with
      `visibleDocumentsWhere`, `rowsFor`, requester names via `Employee.user` with username
      fallback, `facets` from the unfiltered set, filters (`submittedTo` inclusive of its day in
      the company timezone), rows with `department`, `waitingDays`, `currencyCode`,
      `grandTotal`; roll-ups `byDepartment` / `byStep` / `byApprover` / `totals` with per-currency
      `Money.add`; rows ordered by `waitingDays` desc then `docNo`
- [x] 2.3 `approval/pending-summary-workbook.ts`: pure `buildPendingSummaryWorkbook(summary,
      meta)` — title, header lines, three roll-up blocks, totals, detail table with Lao headers,
      fixed currency columns, numeric-serial dates, money cells from decimal strings
- [x] 2.4 Routes on `ApprovalInboxController`: `GET pending-summary` (JSON) and
      `GET pending-summary.xlsx` (`StreamableFile`, attachment
      `pending-approvals-<company code>-<yyyy-mm-dd>.xlsx`), both `@RequirePermissions(P.DOC_VIEW)`
- [x] 2.5 Workbook unit tests (read back with `XLSX.read`): header lines, roll-up blocks, detail
      headers and order (longest wait first), per-currency columns never summed across, date
      serial, blank remark column
- [x] 2.6 DB-backed service tests: `DEPARTMENT`-scope reader sees their department's document that
      waits on another department's approver and not department C's; `COMPANY` scope sees all and
      no other company; only `IN_APPROVAL`; week range, department + overdue, facets from the
      unfiltered set, foreign `departmentId` matches nothing; totals per currency; a two-approver
      document counted under both; requester falls back to username; export writes nothing;
      both routes carry `DOC_VIEW`

## 3. Frontend

- [x] 3.1 `approvalsApi.pendingSummary(filters)` and `approvalsApi.exportPendingSummary(filters)`
      (blob + filename from `Content-Disposition`), types for rows, facets and roll-ups
- [x] 3.2 Route `/approvals/summary` (`name: approvals-summary`, meta permission `DOC_VIEW`);
      a tab header shared by the inbox and summary views showing only the tabs the user may open
- [x] 3.3 `PendingSummaryView.vue`: filter bar (department / type selects from `facets`,
      `DatePicker` range with this-week / last-week / all presets, overdue toggle, active chips),
      roll-up `ReportCard`s (by department with per-currency totals, by step, by approver,
      totals), detail `DataTable` with document links and `formatAmount` per row currency,
      Export-to-Excel button with loading state and failure toast
- [x] 3.4 i18n keys in `en`, `la`, `zh` (tab labels, filters, presets, cards, columns, export)
- [x] 3.5 Component tests: presets send Monday–Sunday day strings; department/type options come
      from facets; export sends the current filters; failure shows a toast; the summary tab is
      absent without `DOC_VIEW` and the inbox tab absent without `DOC_APPROVE`

## 4. Verification

- [x] 4.1 Backend and frontend suites green (`nvm use 22.19.0`, `DB_NAME=erp_test`)
- [x] 4.2 Run against the local restore as a `COMPANY`-scope reader: JSON row count equals the
      `IN_APPROVAL` count, department facet matches `select department_id, count(*)`, and the
      exported workbook opens with the roll-ups and the detail table
- [x] 4.3 Run as a `DEPARTMENT`-scope reader (token with `DOC_VIEW` at `DEPARTMENT` for `ADM`)
      and confirm only ADM's documents appear, including ones waiting on other departments
