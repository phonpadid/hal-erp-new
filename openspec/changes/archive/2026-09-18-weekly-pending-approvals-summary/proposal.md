## Why

Every department reports to its head once a week on what it has submitted and is still waiting
for approval: how many documents, how long they have waited, and who they are waiting on. Today
nothing in the system answers that for a department. The approval inbox shows only what the
*reader* must sign; the Approval Aging report shows the whole company but is gated by
`REPORT_VIEW` (six people hold it, eighty-nine hold `DOC_APPROVE`), has no department column, no
date filter and no export. So the weekly sheet is assembled by hand from the documents screen, and
the head plans from a stale copy.

## What Changes

- A **pending-approvals summary** the department can run itself: every `IN_APPROVAL` document the
  reader may see under their `DOC_VIEW` scope — the same visibility rule as the documents list, so
  a head at `DEPARTMENT` scope sees their department's documents wherever they are stuck, and a
  `COMPANY`-scope reader sees the whole company — with the document's department, requester, submit
  date, days waiting, current step, the approver(s) it is waiting on, amount in its own currency,
  and SLA state.
- **Filters**: department, document type, submitted-date range (the week the department reports
  on), and overdue-only. The department and type option lists are the ones present in the reader's
  pending set, so no extra permission is needed to filter. Quick presets fill the range with this
  week / last week; no range means everything still pending as of today.
- **Roll-ups** over the filtered set: count and oldest wait per department, per current step and per
  waiting approver, and totals per currency — the numbers the head reads first.
- **Export to Excel** of the same filtered set, in one workbook: report header (company, department,
  period, generated at), the roll-ups, then the detail rows. Same shape whichever week it is run
  for, so weeks can be compared side by side.
- A **summary tab on the approvals page** (`/approvals`), beside the inbox, gated by `DOC_VIEW`,
  because that is where the department already goes to see what is waiting.
- The existing `REPORT_VIEW` Approval Aging report keeps its endpoint and shape; its per-document
  computation moves into the shared service so the two cannot drift.

Deliberately NOT in this change:

- **Filters on the inbox itself** (my queue). The department's weekly question is answered by the
  summary; the inbox stays a work queue with its search. Filters there are a separate, smaller
  change if still wanted.
- **A stored weekly snapshot.** The report is computed when run; the exported file *is* the record
  of that week. Storing history is a different feature.

## Capabilities

### New Capabilities

- `pending-approvals-summary`: a company-scoped, `DOC_VIEW`-scoped view of the documents still in
  approval that the reader may see, with filters, roll-ups, and an Excel export.

### Modified Capabilities

- `web-approvals`: the approvals page gains a summary tab with the filters, roll-ups, detail table
  and export button.

## Impact

- **Data model**: none. No new tables or columns; nothing written.
- **Backend**: a new `PendingSummaryService` in `approval/` (rows, roll-ups, filters) reusing
  `DocumentRouteService`, `ApproverResolverService` and `SlaService`; `DocumentService.visibleWhere`
  made reachable to it; two routes on the approval inbox controller (`pending-summary`,
  `pending-summary.xlsx`) under `DOC_VIEW`; `ReportingService.approvalAging` delegates its row
  computation to the new service. Workbook built with `xlsx` as the payables sheet is.
- **Frontend**: `ApprovalInboxView` becomes a two-tab page (inbox / summary) or a sibling route
  `/approvals/summary`; a new `PendingSummaryView` with filter bar, roll-up cards, detail table and
  export; `approvalsApi` additions; i18n in `en`, `la`, `zh`.
- **Invariants**: none at risk. Read-only (invariants 2, 3 untouched). Company isolation and the
  reader's scope come from the same predicate the documents list uses (invariant 1, 5). Money is
  carried as decimal strings, per currency, never converted (invariant 6). Eligibility for
  "waiting on" is the resolver's answer, the same one acting uses (invariant 8).
