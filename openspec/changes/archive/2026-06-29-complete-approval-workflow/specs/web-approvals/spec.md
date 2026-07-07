## MODIFIED Requirements

### Requirement: Approval Inbox

The web app SHALL show a `DOC_APPROVE` user the documents in the active company that are
awaiting their approval — those `IN_APPROVAL` where they are an eligible actor for the
current step and are not the creator — with enough context to triage (document number, type,
requester, base total, current step, age, SLA due time, and overdue/escalation state). Each
item links to the document. Overdue items SHALL be visually distinguished, and items reassigned
by escalation SHALL indicate that they were escalated.

#### Scenario: Inbox lists actionable documents

- **WHEN** a `DOC_APPROVE` user opens the approvals inbox
- **THEN** documents awaiting their action are listed, and documents they created are not

#### Scenario: Empty inbox

- **WHEN** the user has nothing awaiting them
- **THEN** the inbox shows an empty state rather than an error

#### Scenario: Overdue item is flagged

- **WHEN** an item in the inbox has passed its working-hour SLA due time
- **THEN** it is shown with an overdue indicator and its due time

## ADDED Requirements

### Requirement: SLA and Escalation in Document Detail

The web app SHALL surface, on the document detail, the current step's SLA due time and overdue
state, and SHALL render escalation entries from `approval_log` in the approval history timeline
(who it was escalated from, to whom, and when) alongside approve / reject / return entries.

#### Scenario: Timeline shows an escalation

- **WHEN** a document has been escalated for SLA breach
- **THEN** its approval history timeline shows the escalation entry with actor and timestamp

#### Scenario: Detail shows the current step due time

- **WHEN** an eligible approver opens an `IN_APPROVAL` document
- **THEN** the current step's SLA due time is shown, marked overdue when the due time has passed
