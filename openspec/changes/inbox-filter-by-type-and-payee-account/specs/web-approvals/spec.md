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

The inbox SHALL offer a filter panel in the documents list's style, holding:
- department;
- document type;
- a submitted-date range;
- minimum/maximum amount;
- intake state, for a reader who registers arrivals.

Each applied filter SHALL be shown as a removable chip, with a single action that clears them all.
The department filter SHALL be gated by `DEPARTMENT_VIEW`, as on the documents list.

The document-type control SHALL be populated from the types the server reports present in the
reader's own matched set, with their counts, and SHALL NOT be read from a document-type
administration endpoint: an approver is not an administrator, and a list of every type configured in
the company is mostly types they will never see. Selecting one SHALL leave the others offered.

A type filter was previously forbidden here, on the judgement that the panel should stay small. The
people who triage the inbox asked for it: an inbox mixing disbursements, purchase requests and
budget movements cannot be read one kind at a time without it, and the department filter does not
separate them.

The panel SHALL NOT offer:
- a status filter, because every inbox row is pending approval;
- a vendor filter;
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


#### Scenario: The panel filters the inbox to one kind of document

- **GIVEN** an approver whose inbox holds disbursements and purchase requests
- **WHEN** they pick the disbursement type in the filter panel
- **THEN** only disbursements are listed, a removable chip names the type, and the inbox is back on
  its first page

#### Scenario: The type control offers only what the reader's inbox holds

- **GIVEN** a company with twenty configured document types, three of which are in this reader's
  inbox
- **WHEN** the filter panel is opened
- **THEN** the type control offers those three, each with its count

#### Scenario: Clearing all filters clears the type

- **GIVEN** an inbox filtered to one type
- **WHEN** the reader clears all filters
- **THEN** the type chip is gone and every actionable document is listed again
