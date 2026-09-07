## Why

The documents list shows what was raised and never who raised it. Every other screen that lists
documents already names the person: the approvals queue has a Requester column, and the detail view
resolves a `requesterName` so an approver can see who submitted before signing. The list — the
screen people actually live in — is the one place that leaves it out, so answering "who raised this"
means opening documents one at a time.

The data is already on the row. `document.created_by` is NOT NULL and `list()` returns it — as a
bare id, because the list returns raw entities. So the id crosses the wire today and the name does
not, which is the worst of both: no use to a reader, and an identifier they were never meant to key
on.

## What Changes

- Each row of the document list carries `requesterName` — the creator's employee full name in the
  active company, and their account username when they have no employee record — and
  `requesterDepartment`, that employee's own department, which is null exactly when there is no
  employee record (`employee.department_id` is NOT NULL, so an employee always has one). Exactly the rule
  `detail()` already applies, so the same document names the same person on both screens.
- The name is resolved for the whole page in two reads, not one per row.
- The list stops returning `created_by` as a raw id. A reader is given the name or nothing.
- The list gains a Requester column and a Department column, both placed with the other secondary
  columns so they collapse on narrow screens like Created and Next approver do.

The Department column names the PERSON's department, not the document's. The list already filters by
`document.department_id`, so the two can disagree for a creator who has since transferred — the
filter would keep a row whose column reads differently. Named here because it is a property of what
was asked for, not a defect to be found later.

Explicitly out of scope: filtering or sorting the list by requester (the existing `mine` filter
already answers the common case), and showing the creator anywhere the reader could not already see
the document.

## Capabilities

### Modified Capabilities

- `document-engine`: the document list read names who raised each document, resolved the same way
  the detail read resolves it.
- `web-documents`: the list shows that name as a column (Requirement: Document List and Detail).

## Impact

**Schema** — none. `document.created_by` already exists and is NOT NULL.

**Backend** — `document.service.ts` (`list()` gains the batched name resolution and stops returning
the raw `createdBy`).

**Frontend** — `api/documents.ts` (`DocumentSummary`), `views/documents/MyDocumentsView.vue` (the
column), i18n for `en`, `la`, `zh`.

**Invariants** — company scope is untouched: the name is resolved through the same
`forActiveCompany()` EM, and the employee lookup is scoped to the document's own company, so a
creator's name from another company can never be printed. Visibility is untouched: this adds a field
to rows the reader was already permitted to see, and grants no row they were not. Authorization
stays on `DOC_VIEW`.

**Concurrency** — none. Nothing here writes.
