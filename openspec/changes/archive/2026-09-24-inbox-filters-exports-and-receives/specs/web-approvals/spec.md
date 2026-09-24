## MODIFIED Requirements

### Requirement: Approval Inbox

The web app SHALL show a `DOC_APPROVE` user the documents in the active company that are
awaiting their approval — those `IN_APPROVAL` where they are an eligible actor for the
current step and are not the creator — with enough context to triage (document number, type,
requester, base total, current step, age, SLA due time, and overdue/escalation state). The base
total SHALL be formatted using the company base currency's `decimal_places`. Each item links to the
document. Overdue items SHALL be visually distinguished, and items reassigned by escalation SHALL
indicate that they were escalated.

The inbox is paginated, so a search offered on it SHALL resolve against the WHOLE pending set on the
server and SHALL NOT filter only the page already loaded. An approver with more documents than fit
on one page has no other way to find one; a box that filters the current page is worse than none,
because a term that matches nothing on this page is indistinguishable from a term that matches
nothing at all.

A search control SHALL NOT be offered unless it is wired to something that filters. A table rendered
in a mode where its filter bindings are ignored — such as a lazy/server-paged table given
client-side `filters` — SHALL either handle the filter itself or not present the control.

The inbox SHALL offer a filter panel in the documents list's style, holding exactly three filters:
- department;
- a submitted-date range;
- minimum/maximum amount.

Each applied filter SHALL be shown as a removable chip, with a single action that clears them all.
The department filter SHALL be gated by `DEPARTMENT_VIEW`, as on the documents list.

The panel SHALL NOT offer:
- a status filter, because every inbox row is pending approval;
- a document-type or vendor filter;
- an "only mine" filter, because a reader's own documents are never in their inbox.

Like the search, the filters SHALL be answered by the server across the whole pending set, and changing any of them SHALL return the inbox to its
first page. Amount bounds SHALL travel as the strings typed and SHALL never be converted to a JS
number.

#### Scenario: Inbox lists actionable documents

- **WHEN** a `DOC_APPROVE` user opens the approvals inbox
- **THEN** documents awaiting their action are listed, and documents they created are not

#### Scenario: Search finds a document on a later page

- **GIVEN** an approver whose pending queue spans more than one page
- **WHEN** they search for the number of a document that is not on the page currently shown
- **THEN** that document is listed

#### Scenario: A search that matches nothing says so

- **WHEN** the approver searches for a term no pending document matches
- **THEN** the inbox shows an empty result for that search rather than the unfiltered list

#### Scenario: Empty inbox

- **WHEN** the user has nothing awaiting them
- **THEN** the inbox shows an empty state rather than an error

#### Scenario: Overdue item is flagged

- **WHEN** an item in the inbox has passed its working-hour SLA due time
- **THEN** it is shown with an overdue indicator and its due time

#### Scenario: Base total is formatted by decimal places

- **WHEN** the inbox lists an item
- **THEN** its base total is shown formatted to the base currency's `decimal_places`

#### Scenario: Filtering the inbox by department

- **GIVEN** an approver on page 2 of their inbox
- **WHEN** they choose a department in the filter panel
- **THEN** the inbox reloads from page 1 with only that department's documents, and a chip naming
  the department is shown

#### Scenario: Removing a chip removes its filter

- **GIVEN** an inbox filtered by department and by a submitted-date range
- **WHEN** the approver removes the department chip
- **THEN** the inbox is filtered by the date range alone

#### Scenario: The inbox panel offers department, date and amount only

- **WHEN** an approver opens the inbox's filter panel
- **THEN** it offers department, submitted date and amount, and no status, type, vendor or "only
  mine" control

## ADDED Requirements

### Requirement: The Inbox Exports Its Pending Documents To Excel

The approvals inbox SHALL offer an Excel export to every user who can see the inbox. The export
SHALL download the payables workbook of the whole pending set under the filters and search
currently on screen — including a filter chosen a moment ago that the debounced reload has not
applied yet — and SHALL NOT be limited to the page shown. While the file is being prepared the
action SHALL show that it is busy and SHALL NOT start a second export. A failed export SHALL
explain itself in a toast and leave the action usable.

#### Scenario: Export follows the filters on screen

- **GIVEN** an inbox filtered to one department and a submitted-date range
- **WHEN** the approver exports
- **THEN** the downloaded workbook holds that department's pending documents in that range from
  every page, and no other

#### Scenario: A failed export is reported and recoverable

- **WHEN** the export request fails
- **THEN** a toast explains the failure and the export action is enabled again

### Requirement: Finance Registers Arrivals From The Inbox

The approvals inbox SHALL offer the documents list's intake affordances, gated identically, to
users holding `DOC_INTAKE_RECEIVE` or `DOC_INTAKE_REVERSE`:
- an intake column stating whether each document has been received and, when it has, by whom and
  when;
- row selection with a bulk receive action;
- a receive action on the row itself;
- a reverse action offered only with `DOC_INTAKE_REVERSE`.

A user holding neither code SHALL see the inbox without the column, the selection or the actions.

Whether a row may be received SHALL be the server's per-row `canReceive`, never a guess made by the
client. The bulk action SHALL count only the selected rows that may be received. After a batch, the
inbox SHALL report how many were received and SHALL name each refused document with its reason. The
selection SHALL be cleared whenever the rows shown change, so an action is never applied to a row
the user did not tick. Intake SHALL go through the same receive and reverse endpoints as the
documents list, so the two screens can never disagree about a document's intake state.

#### Scenario: Finance receives the week's arrivals from the inbox

- **GIVEN** a finance approver holding `DOC_INTAKE_RECEIVE`, with the inbox filtered to this week
- **WHEN** they tick several unreceived rows and register receipt
- **THEN** each of those rows reads as received, naming them and the time

#### Scenario: A received document stays in the inbox until it is acted on

- **GIVEN** a document finance has received but not yet approved
- **WHEN** finance views the inbox
- **THEN** the document is still listed, reads as received, and offers no receive action

#### Scenario: An approver with no intake duty sees the inbox unchanged

- **WHEN** a `DOC_APPROVE` user holding neither intake code opens the inbox
- **THEN** there is no intake column, no row selection and no receive action

#### Scenario: A partly refused batch names what it refused

- **GIVEN** a selection in which a colleague received one document a moment earlier
- **WHEN** the user registers receipt of the selection
- **THEN** the others read as received and the inbox names the refused document and why

#### Scenario: Paging clears the selection

- **GIVEN** a user who has ticked rows on page 1
- **WHEN** they move to page 2
- **THEN** no rows are selected and the bulk action counts zero
