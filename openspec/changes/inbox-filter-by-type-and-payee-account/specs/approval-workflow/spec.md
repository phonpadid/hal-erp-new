## MODIFIED Requirements

### Requirement: Approval Inbox Query

The system SHALL provide a read of the documents a user may currently act on: the active
company's `IN_APPROVAL` documents whose current step lists the user as an eligible actor
(targeted user, or a holder of the targeted role, or that principal's active one-hop
delegate) and that the user did not create. The query SHALL apply the same eligibility and
self-approval rules as acting, so it never lists a document the user cannot actually act on.
The read SHALL require `DOC_APPROVE` and be scoped to the active company.

The read SHALL accept optional narrowing filters: `departmentId`, `documentTypeId`,
`submittedFrom` / `submittedTo` (calendar days on `document.submitted_at`, `submittedTo`
inclusive to the end of that day), and `minAmount` / `maxAmount` (inclusive bounds on
`document.base_total_amount`, carried as decimal strings and never as a JS number). Each filter
SHALL be validated as the documents list validates the same field, and a malformed value SHALL be
refused with 400 rather than ignored. Filters SHALL only ever narrow the actionable set: a filter
SHALL NOT admit a document the unfiltered read would not list, and SHALL NOT reach another company's
documents. The filters and the search SHALL be applied across the whole actionable set BEFORE the
page window, so `total` is the count of documents that match.

The response SHALL also report the `document_type` rows present in the WHOLE matched set — id, code,
name and the count of matching documents — so a client can offer the type filter without asking a
second, differently-permissioned endpoint what the types are. The facets SHALL be computed from the
set AFTER the other filters and the search, so they describe what the reader is actually looking at,
and the type filter's own value SHALL NOT narrow them, or choosing a type would erase every other
choice from the control that offered it.

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


#### Scenario: The type filter narrows the actionable set

- **GIVEN** an approver whose inbox holds four disbursements and two purchase requests
- **WHEN** they request their pending approvals with `documentTypeId` = the disbursement type
- **THEN** exactly the four disbursements are listed and `total` is 4

#### Scenario: The facets describe the whole matched set, not the page

- **GIVEN** an approver with twelve actionable documents of three types and a page size of 10
- **WHEN** they request the first page
- **THEN** the facets name all three types with the counts they have across all twelve

#### Scenario: Choosing a type leaves the other types offered

- **GIVEN** an inbox holding two types
- **WHEN** the reader filters to one of them
- **THEN** the rows are of that type alone and the facets still name both, so the control can offer
  the other
