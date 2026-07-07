## MODIFIED Requirements

### Requirement: Approval Inbox

The web app SHALL show a `DOC_APPROVE` user the documents in the active company that are
awaiting their approval — those `IN_APPROVAL` where they are an eligible actor for the
current step and are not the creator — with enough context to triage (document number, type,
requester, base total, current step, age, SLA due time, and overdue/escalation state). The base
total SHALL be formatted using the company base currency's `decimal_places`. Each item links to the
document. Overdue items SHALL be visually distinguished, and items reassigned by escalation SHALL
indicate that they were escalated.

#### Scenario: Inbox lists actionable documents

- **WHEN** a `DOC_APPROVE` user opens the approvals inbox
- **THEN** documents awaiting their action are listed, and documents they created are not

#### Scenario: Empty inbox

- **WHEN** the user has nothing awaiting them
- **THEN** the inbox shows an empty state rather than an error

#### Scenario: Overdue item is flagged

- **WHEN** an item in the inbox has passed its working-hour SLA due time
- **THEN** it is shown with an overdue indicator and its due time

#### Scenario: Base total is formatted by decimal places

- **WHEN** the inbox lists an item
- **THEN** its base total is shown formatted to the base currency's `decimal_places`
