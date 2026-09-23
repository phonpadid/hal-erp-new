## Why

Approvers — finance above all — work from the approvals inbox, but the inbox only has a search box.
Everything they need to sort through the week's pending work lives on the documents list: filters,
the payables Excel sheet, and the intake actions. So finance clears the queue on one screen and has
to switch to the other, where the pending documents are mixed in with every other status, to filter,
export or register what arrived. The inbox should offer the same tools, applied to the documents
waiting on this reader and nothing else.

## What Changes

- **Filters on the inbox.** A filter popover with removable chips, in the documents list's style,
  comes to `/approvals` with exactly three filters:
  - department;
  - submitted-date range;
  - min/max base amount.

  The status is fixed at pending, because every inbox row is `IN_APPROVAL`, so no status filter is
  offered. The documents list's type, vendor and *only mine* filters are not carried over. *Only
  mine* could never match here, because a reader's own documents are never in their inbox
  (invariant 8).

  The server answers the filters across the whole pending set before the page window, as it
  already does for search.
- **Excel export of the inbox.** A new read returns the payables workbook (the same sheet as the
  documents list's export) for the whole filtered inbox set, with no page window. Its rows are
  exactly the documents the inbox would list for the same filters.
- **Intake from the inbox.** For holders of `DOC_INTAKE_RECEIVE` / `DOC_INTAKE_REVERSE`, the inbox
  gets tick-to-select with a bulk receive, a per-row receive, a reverse action and an intake
  column. These are the same actions and endpoints as the documents list. Each inbox row carries
  its derived intake state (`received`, `receivedByName`, `receivedAt`, `canReceive`).
- **The requester is named the way the list names them.** The row gets the resolved employee name
  and department, where it currently carries the login name. This comes free with reusing the
  list's row resolution.

**What does NOT change:**
- Which documents the inbox holds. It is still the reader's actionable set: `IN_APPROVAL`, the
  reader is an eligible actor on the current step (including delegation and escalation), and the
  reader is not the creator.
- Filters only ever narrow that set.
- Budget, quota, numbering and FX are untouched.
- Receipt stays in the append-only `document_intake_log`, and no new table is introduced.

Not breaking: the new query parameters are optional, the new row fields are additive, and the export
is a new route.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `approval-workflow`:
  - The *Approval Inbox Query* accepts the narrowing filters.
  - Each row carries its intake state and resolved requester identity.
  - A new *Inbox Payables Export* read returns the workbook of the filtered actionable set.
- `web-approvals`:
  - The *Approval Inbox* offers the department, date and amount filters, the Excel export and the
    intake actions.
  - These are gated by permission code the same way as on the documents list.

`document-intake` is **not** modified. The inbox calls the existing receive and reverse endpoints,
and their rules still decide: a document is receivable once it has been at the reader's desk, and
reversal is a separate code. The inbox is simply one more place those actions are offered.

**Invariants at risk, and how they are held:**
- **8, no self-approval.** The filters and the export narrow the actionable set and never replace
  it, so neither can surface the reader's own document.
- **1, company isolation.** The inbox read already names the company explicitly, and the export
  reuses that read, so it cannot see another company's documents.
- **2, append-only ledgers.** Intake keeps writing through the existing service, so this stays
  unaffected.

## Impact

- **Backend:**
  - `approval/dto/workflow.dto.ts`: `PendingInboxQueryDto` gains `departmentId`,
    `submittedFrom` / `submittedTo` and `minAmount` / `maxAmount`, validated like
    `DocumentListQueryDto` (`@IsUUID`, `@IsDateString`, `@IsNumberString`).
  - `approval/approval-inbox.service.ts`: the filters go into the DB query before the eligibility
    check; rows gain intake state and requester identity.
  - `approval/approval-inbox.controller.ts`: new `GET /approvals/pending/payables.xlsx`, gated on
    `DOC_APPROVE`.
  - `document/document.service.ts`: the payables row builder is split out of `exportPayables` so it
    can take a given set of documents.
- **Frontend:**
  - `views/approvals/ApprovalInboxView.vue`
  - `stores/approvals.ts` (filters state)
  - `api/approvals.ts` (filter params, export, `intake` on `PendingApproval`)
  - i18n keys in every locale
- **Permissions:** no new codes. It reuses `DOC_APPROVE`, `DOC_INTAKE_RECEIVE` and
  `DOC_INTAKE_REVERSE`.
- **Migrations:** none.
