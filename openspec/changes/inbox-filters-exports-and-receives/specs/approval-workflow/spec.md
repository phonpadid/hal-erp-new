## MODIFIED Requirements

### Requirement: Approval Inbox Query

The system SHALL provide a read of the documents a user may currently act on: the active
company's `IN_APPROVAL` documents whose current step lists the user as an eligible actor
(targeted user, or a holder of the targeted role, or that principal's active one-hop
delegate) and that the user did not create. The query SHALL apply the same eligibility and
self-approval rules as acting, so it never lists a document the user cannot actually act on.
The read SHALL require `DOC_APPROVE` and be scoped to the active company.

The read SHALL accept optional narrowing filters: `departmentId`, `submittedFrom` / `submittedTo` (calendar days on `document.submitted_at`, `submittedTo`
inclusive to the end of that day), and `minAmount` / `maxAmount` (inclusive bounds on
`document.base_total_amount`, carried as decimal strings and never as a JS number). Each filter
SHALL be validated as the documents list validates the same field, and a malformed value SHALL be
refused with 400 rather than ignored. Filters SHALL only ever narrow the actionable set: a filter
SHALL NOT admit a document the unfiltered read would not list, and SHALL NOT reach another company's
documents. The filters and the search SHALL be applied across the whole actionable set BEFORE the
page window, so `total` is the count of documents that match.

Each row SHALL name who raised the document the way the documents list does — the employee's full
name in the document's company, else the login name — together with their department. Each row SHALL
carry the document's derived intake state (`received`, `receivedByName`, `receivedAt`,
`canReceive`), computed by the same read the documents list uses. `canReceive` SHALL be resolved
only for a reader holding `DOC_INTAKE_RECEIVE` and SHALL be false for every other reader.

#### Scenario: Lists only actionable documents

- **WHEN** a `DOC_APPROVE` user requests their pending approvals
- **THEN** the response contains the active company's `IN_APPROVAL` documents for which they
  are an eligible actor on the current step

#### Scenario: Excludes own and non-actionable documents

- **WHEN** the pending list is built
- **THEN** documents the user created, and documents not `IN_APPROVAL` or not targeting the
  user's role/delegation, are excluded

#### Scenario: A filter narrows the actionable set across every page

- **GIVEN** an approver with twelve actionable documents, three of them from department D, one of
  which would fall on the second page unfiltered
- **WHEN** they request their pending approvals with `departmentId` = D and a page size of 10
- **THEN** the response lists exactly those three documents and `total` is 3

#### Scenario: A filter cannot surface a document the approver may not act on

- **GIVEN** an `IN_APPROVAL` document of department D that the approver raised, and another of
  department D waiting on a step they are not eligible for
- **WHEN** they request their pending approvals filtered to department D
- **THEN** neither document is listed

#### Scenario: The submitted-date range is inclusive of its last day

- **GIVEN** an actionable document submitted at 16:00 on 2026-09-18
- **WHEN** the approver filters with `submittedFrom` = `2026-09-14` and `submittedTo` = `2026-09-18`
- **THEN** that document is listed

#### Scenario: Amount bounds compare decimals, not floats

- **GIVEN** actionable documents with base totals `1000000` and `1000000.01`
- **WHEN** the approver filters with `maxAmount` = `1000000`
- **THEN** only the first is listed

#### Scenario: A malformed filter is refused

- **WHEN** the pending read is requested with `minAmount` = `abc` or `departmentId` = `x`
- **THEN** the request is refused with 400

#### Scenario: Each row carries its intake state

- **GIVEN** a reader holding `DOC_INTAKE_RECEIVE` whose inbox holds one document already received by
  a colleague and one not yet received
- **WHEN** they request their pending approvals
- **THEN** the first row reads `received` with the colleague's name and time and `canReceive` false,
  and the second reads not received with `canReceive` true

#### Scenario: A reader without the intake code is never told they may receive

- **WHEN** a `DOC_APPROVE` user who does not hold `DOC_INTAKE_RECEIVE` requests their pending approvals
- **THEN** every row carries `canReceive` false

#### Scenario: The requester is named, not their login

- **GIVEN** a document raised by a user whose employee record names them "Jiji Phommavong" in the
  Finance department
- **WHEN** it appears in an approver's pending list
- **THEN** the row names "Jiji Phommavong" and "Finance", not the login name

## ADDED Requirements

### Requirement: Inbox Payables Export

The system SHALL provide the payables workbook for the reader's approval inbox: the same sheet,
the same columns and the same per-currency precision as the documents list's payables export,
holding EVERY document the Approval Inbox Query would list for the same filters and search, with no
page window. Its rows SHALL be exactly that set. The export SHALL NOT include a document the reader
created, one not `IN_APPROVAL`, or one waiting on a step the reader is not eligible for, whatever
the reader's `DOC_VIEW` scope. The read SHALL require `DOC_APPROVE`, SHALL be scoped to the active
company, and SHALL write nothing.

The file SHALL be named for the company and the day of export, so two exports taken on different
days do not overwrite each other in a downloads folder.

#### Scenario: The export holds the whole filtered inbox

- **GIVEN** an approver whose inbox, filtered to one department, holds 23 documents across three
  pages
- **WHEN** they export with the same filter
- **THEN** the workbook holds those 23 documents and no others

#### Scenario: A reader with company-wide view still exports only their inbox

- **GIVEN** an approver with `DOC_VIEW` at COMPANY scope and five documents actionable by them among
  forty in approval
- **WHEN** they export their inbox
- **THEN** the workbook holds the five

#### Scenario: Export requires the approve code

- **WHEN** a user without `DOC_APPROVE` requests the inbox export
- **THEN** the request is refused with 403
