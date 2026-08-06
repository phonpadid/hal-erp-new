# web-settlement Specification

## Purpose
The finance web surface for recording and reading the settlement of a document that accrues its expense at approval — the unsettled queue, the record-settlement form (CASH-only, evidence required), and the read of a document's settled state. Distinct from `web-payments` (the FX payment / Ready-to-Pay flow): recording a settlement writes `document_settlement`, whereas recording a payment writes a `payment`. It exposes settlement behavior already specified in `document-engine`.

## Requirements
### Requirement: Unsettled Settlements Queue

The web app SHALL show a `PAYMENT_MANAGE` user the active company's queue of documents that accrue their expense at approval, are fully approved, and have no settlement recorded yet — sourced from `GET /documents/unsettled`. Each row SHALL show the document number, its department, its total amount, and when it was approved, and SHALL link to where the settlement is recorded. The queue and the record affordance SHALL be shown only to a user holding `PAYMENT_MANAGE` (UX only; the server enforces and scopes by the active company). A document SHALL leave the queue as soon as its settlement is recorded.

#### Scenario: Lists approved documents awaiting settlement

- **WHEN** a `PAYMENT_MANAGE` user opens the settlements queue
- **THEN** the active company's accrue-on-approval, fully approved documents with no `document_settlement` row are listed with document number, department, total amount, and approval date

#### Scenario: A settled document is not in the queue

- **GIVEN** a document whose settlement has just been recorded
- **WHEN** the settlements queue is reloaded
- **THEN** that document is no longer listed

#### Scenario: Empty queue

- **WHEN** nothing is awaiting settlement
- **THEN** the list says so rather than rendering an empty area

#### Scenario: Queue hidden without permission

- **GIVEN** a user who does not hold `PAYMENT_MANAGE`
- **WHEN** the app renders navigation and routes
- **THEN** the settlements queue is not reachable and its navigation entry is not shown

### Requirement: Record a Settlement With Evidence

The web app SHALL let a `PAYMENT_MANAGE` user record how an approved, accrue-on-approval document was finally settled, by calling `POST /documents/:id/settle` as multipart with `settlementType`, `settledAt`, an optional `reference`, an optional `note`, and one required evidence file. The form SHALL offer `CASH` as the only settlement type and SHALL refuse to submit any other value, mirroring the server's CASH-only rule. The form SHALL NOT submit without an evidence file. On success the app SHALL reflect the document as settled without a page reload. The record affordance SHALL NOT be offered to a session authenticated by an API key — the server denies it and the client hides it (UX only).

#### Scenario: Record a CASH settlement with a slip

- **GIVEN** a `PAYMENT_MANAGE` user on an approved, accrue-on-approval document with no settlement
- **WHEN** the user records a `CASH` settlement with a date, a reference, and one evidence file
- **THEN** the settlement is submitted, the document is shown as settled, and it leaves the unsettled queue

#### Scenario: Evidence is required

- **GIVEN** the record-settlement form
- **WHEN** the user tries to submit without attaching a file
- **THEN** the form blocks submission and asks for evidence, and no request is sent

#### Scenario: Only CASH is offered

- **WHEN** the user opens the settlement-type control
- **THEN** `CASH` is the only selectable type, and the form cannot submit any other value

#### Scenario: The same document cannot be settled twice

- **GIVEN** a document that already has a settlement
- **WHEN** a `PAYMENT_MANAGE` user attempts to record another
- **THEN** the app does not offer the record action for that document, and a direct attempt is rejected and surfaced as already settled

#### Scenario: Record affordance hidden for an API-key session

- **GIVEN** a session authenticated by an API key whose bound user holds `PAYMENT_MANAGE`
- **WHEN** a document detail or the settlements queue is opened
- **THEN** the record-settlement action is not shown

### Requirement: Read a Document's Settled State

The web app SHALL show whether a document has been settled and, when it has, its `settlementType`, `settledAt`, and `reference`, read from `GET /documents/:id/settlement` and visible to a `DOC_VIEW` user. A 404 from that read SHALL be rendered as "approved, awaiting settlement" — a normal state for an approved document, not an error.

#### Scenario: A settled document shows its settlement

- **GIVEN** a document with a recorded settlement
- **WHEN** a `DOC_VIEW` user opens it
- **THEN** its settlement type, settlement date, and reference are shown

#### Scenario: Approved but unsettled is not an error

- **GIVEN** an approved document with no settlement yet
- **WHEN** a `DOC_VIEW` user opens it
- **THEN** it is shown as "approved, awaiting settlement" with no error surfaced

### Requirement: Settlement Is Distinct From Ready-to-Pay

The web app SHALL present recording a settlement and recording a payment as two separate actions with distinct labels and entry points, so a finance user does not settle an accruing document through the Ready-to-Pay payment flow. Recording a settlement (this capability) writes `document_settlement`; recording a payment (`web-payments`) records a `payment` with its FX result. The settlements surface SHALL make clear it is for documents that accrue at approval, and SHALL NOT list `CUT_BUDGET` disbursements that belong to Ready-to-Pay.

#### Scenario: The two actions are not interchangeable

- **WHEN** a `PAYMENT_MANAGE` user views the finance surfaces
- **THEN** "record a settlement" and "record a payment" are distinct, separately labelled actions, and the settlements queue lists only accrue-on-approval documents awaiting settlement
