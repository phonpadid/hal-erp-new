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
