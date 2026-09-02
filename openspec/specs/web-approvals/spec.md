# web-approvals

## Purpose
The Vue approver inbox for end users: a company-scoped list of the documents pending the
signed-in user's approval (those `IN_APPROVAL` where they are an eligible actor for the
current step and are not the creator), with enough context to triage and a link to each
document. From a document an eligible approver can act with Approve / Reject / Return plus an
optional remark, surfacing server-side rejections. All affordances honor no-self-approval and
are gated by the `DOC_APPROVE` permission code (client-side UX only; the server remains
authoritative).
## Requirements
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

### Requirement: Act on a Document

The web app SHALL let an eligible approver Approve, Reject, or Return a document with an
optional remark, and reflect the resulting status. Server-side rejections (not eligible, not
in approval, self-approval) SHALL be surfaced.

#### Scenario: Approve advances the document

- **WHEN** an eligible approver approves a document on its final step
- **THEN** the document becomes COMPLETED and the action appears in its approval log

#### Scenario: Reject releases and stops routing

- **WHEN** an eligible approver rejects a document
- **THEN** the document becomes REJECTED and the detail reflects it

### Requirement: No Self-Approval in the UI

The approval action affordances SHALL be hidden when the signed-in user is the document's
creator, even if they hold `DOC_APPROVE` (UX mirror of invariant 8; the server still
enforces).

#### Scenario: Creator sees no approve action

- **WHEN** a user who created a document views it while it is IN_APPROVAL
- **THEN** the Approve / Reject / Return actions are not shown to them

### Requirement: Permission-Gated Approval Affordances

The approvals inbox and the act buttons SHALL be shown only to users holding `DOC_APPROVE`
(UX only; the server enforces on every action).

#### Scenario: Inbox hidden without permission

- **WHEN** a user without `DOC_APPROVE` is signed in
- **THEN** the Approvals navigation entry and inbox are not shown

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

