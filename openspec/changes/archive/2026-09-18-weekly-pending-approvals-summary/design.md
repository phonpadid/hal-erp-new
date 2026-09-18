## Context

Three things already exist and none is the department's weekly report:

- `ApprovalInboxService.pending` — loads every `IN_APPROVAL` document of the company, keeps the
  ones the caller may act on (resolver eligibility + no self-approval), searches, pages. It is a
  work queue and deliberately so.
- `ReportingService.approvalAging` — every `IN_APPROVAL` document of the company with step,
  waiting-on approvers, age in hours, time-in-step, SLA. Gated by `REPORT_VIEW` (6 holders in
  production against 89 `DOC_APPROVE` holders), no department, no filters, no export.
- `DocumentService.visibleWhere` — the reader's `DOC_VIEW` scope as a `where` fragment, widened by
  the documents they are party to. Private today; it is what makes the documents list show a
  department head their department.

The per-document computation (route step → eligible actors → SLA due) is the same in the inbox and
the aging report and is the expensive part: one `routeStep` and one `eligible` per document.

## Goals / Non-Goals

**Goals:**
- One service that answers "what is still waiting, that this reader may see", filtered by
  department / type / week / overdue, with roll-ups, as JSON and as one `.xlsx`.
- Reuse: the scope predicate from the documents list, the step/eligibility/SLA computation from
  the aging report, the workbook pattern from the payables sheet.
- No new permission and no new table.

**Non-Goals:**
- Filters on the inbox tab.
- Stored weekly snapshots or week-over-week deltas.
- Changing what the `REPORT_VIEW` aging report returns.

## Decisions

### D1. Scope by `DOC_VIEW`, not by a new permission or by `REPORT_VIEW`

The head of a department already sees the department's documents on the documents list because
their `DOC_VIEW` grant is `DEPARTMENT` scope. The summary is the same documents, narrowed to
`IN_APPROVAL` and annotated with where they wait — so it takes the same predicate.
`DocumentService.visibleWhere` becomes public (`visibleDocumentsWhere(em)`), and the summary
builds `{ $and: [visible, { status: IN_APPROVAL }, filters] }` on the company-scoped EM. A
`COMPANY`-scope reader gets the company; nobody gets more than the list would show them.

*Alternative:* grant `REPORT_VIEW` to every head. Rejected — that opens every financial report to
answer one question, and the report still lacks the department dimension.

### D2. One computation, two callers

`PendingSummaryService.rowsFor(docs)` in `approval/` does the per-document work (route step,
eligible actors, names, SLA). `ReportingService.approvalAging` calls it and keeps mapping to its
own row shape (hours, `timeInStepHours`), so its endpoint and tests stay as they are. The summary
maps the same intermediate to its own rows (days, department, currency). One place computes
"waiting on"; it cannot disagree with the inbox because both go through the resolver.

Requester name: `Employee.user` links an employee to an app user. The summary resolves
`employee.full_name` for the creator when one exists and falls back to `username` — a head reads
"ນາງ ພອນສະຫວັນ", not `phonsavanh`. One `find(Employee, { user: { $in } })` per request.

### D3. Filters apply after the scope, before the roll-ups; facets come from before the filters

Order in the service: scoped `IN_APPROVAL` set → compute rows → `facets` (departments, types with
counts) from that set → apply `departmentId` / `documentTypeId` / `submittedFrom..To` /
`overdueOnly` → roll-ups and totals over the filtered rows. `submittedTo` is inclusive of its day
in the company timezone (`localMidnightInstant(next day) - 1ms`, as the attendance code reasons
about days). Facets from the unfiltered set are what lets the client offer "which departments
could I look at" without a `DEPARTMENT_VIEW`-gated master list.

The date filter is on `submitted_at`, not `created_at`: the week the department *submitted* is the
week it reports on, and a draft that sat for a month before submission belongs to the week it
went out.

### D4. Days, not hours, and per-currency money

The head's unit is days; `waitingDays = floor((now - submittedAt) / 86400000)`. Amounts are the
document's `grand_total` in its own currency (as the payables sheet), summed per currency with
`Money.add`, never converted (invariant 6). `overdue` and `slaDueAt` are computed exactly as the
aging report does, via `SlaService.stepDueAt` on the step's `startedAt`.

### D5. Workbook: same builder pattern as the payables sheet

`pending-summary-workbook.ts`, pure: `buildPendingSummaryWorkbook(summary, meta): Buffer`. One
sheet: title, four header lines, a blank line, `byDepartment` block, `byStep` block, `byApprover`
block, `totals` line, blank line, then the detail table with the Lao headers from the spec. Dates
as numeric serials with `dd/mm/yyyy` (the `t: 'd'` type is invisible in Google Sheets, learned on
the payables sheet); money cells `{ t: 'n', v: Number(fixed), z }` at the last step. Currency
columns fixed `LAK, THB, USD, CNY` then others present. Unit-tested by reading the buffer back.

### D6. Routes and UI placement

`GET /approvals/pending-summary` and `GET /approvals/pending-summary.xlsx` on
`ApprovalInboxController`, `@RequirePermissions(P.DOC_VIEW)` (the inbox's own `pending` stays
`DOC_APPROVE`). Query DTO `PendingSummaryQueryDto` with class-validator on each field.

Frontend: `/approvals` gets a `TabMenu`-style header with two tabs — **inbox** (existing view,
`DOC_APPROVE`) and **summary** (new `PendingSummaryView`, route `/approvals/summary`, meta
permission `DOC_VIEW`). A user with only one of the permissions sees only that tab. The summary
view has the filter bar (department / type selects fed by `facets`, `DatePicker` range with
this-week / last-week / all `Button`s computing Monday–Sunday as `YYYY-MM-DD` day strings in the
browser's local calendar, overdue `ToggleSwitch`), roll-up `ReportCard`s, the detail `DataTable`, and the
export `Button` (`pi pi-file-excel`) reusing `downloadBlob`. Money via `formatAmount` with the
row's currency.

## Risks / Trade-offs

- [Per-document route + eligibility resolution is O(n) queries] → identical cost to the existing
  aging report and inbox, which already run over the same set; the scope predicate usually makes
  the department's set far smaller than the company's. If a company-scope reader's set grows into
  thousands, batching `routeStep`/`eligible` is the next step, for all three callers at once.
- [A creator without an employee record shows a username] → stated fallback; the employee link is
  the fix, not the report.
- [Two tabs on one route family] → the inbox view is untouched apart from the tab header; its
  spec and tests still hold.
- [Week presets are computed in the browser's calendar] → the client sends day strings, and the
  server is what turns a day into an instant, in the company timezone. The auth store does not
  carry the company timezone today; a viewer in another zone would see the week boundaries of
  their own calendar, which for one company in one country is the same week.

## Migration Plan

No migration. Deploy backend then frontend; both routes are additive.

## Open Questions

- None blocking. Whether the inbox tab should later get the same filter bar is left to a follow-up.
