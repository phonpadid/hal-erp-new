# document-engine

## ADDED Requirements

### Requirement: Withdrawing A Document Is Recorded As An Act

Withdrawing a document SHALL append a `CANCEL` row to `approval_log` naming the acting user, the
`step_no` the document had reached, the moment it happened, and an optional remark supplied with the
request. The row SHALL be written in the same database transaction as the `CANCELLED` status
transition, so a withdrawn document and the record of who withdrew it commit together or not at all.

A withdrawal from `DRAFT` SHALL be recorded with `step_no` `0` — the value `document.current_step_no`
carries until routing starts. `approval_log.step_no` is non-null, and `0` already means "no step
reached".

The row SHALL NOT carry a signature, as `REJECT` and `RETURN` do not. The withdrawal SHALL remain
restricted to the document's creator and to the `DRAFT`, `SUBMITTED` and `IN_APPROVAL` statuses, and
SHALL continue to release every budget, quota and stock hold (invariant 4, invariant 5).

Withdrawing an already-`CANCELLED` document SHALL remain a no-op: exactly one `CANCEL` row exists per
withdrawal, so a retried request does not write a second.

The system SHALL emit a `document.cancelled` event after the transaction commits, carrying the
document, the requester and the step it was withdrawn from, so notification and any later capability
can react to a withdrawal as they react to a rejection.

#### Scenario: Withdrawing a routing document records who did it

- **GIVEN** a document in `IN_APPROVAL` at step 2
- **WHEN** its creator withdraws it with the remark "raised against the wrong budget"
- **THEN** the document is `CANCELLED`, and one `approval_log` row exists with action `CANCEL`,
  the creator as actor, `step_no` 2, and that remark

#### Scenario: The record and the status are one transaction

- **GIVEN** a document in `IN_APPROVAL`
- **WHEN** it is withdrawn
- **THEN** no state exists in which the document is `CANCELLED` and its `CANCEL` row is absent

#### Scenario: A withdrawn draft is recorded at step zero

- **GIVEN** a `DRAFT` document that has never routed
- **WHEN** its creator withdraws it
- **THEN** a `CANCEL` row is written with `step_no` `0`

#### Scenario: The remark is optional

- **WHEN** a document is withdrawn with no remark
- **THEN** the `CANCEL` row is written with a null remark and the withdrawal succeeds

#### Scenario: No signature is stamped

- **WHEN** a document is withdrawn
- **THEN** the `CANCEL` row's `signature_id` is null

#### Scenario: Withdrawing twice writes one row

- **GIVEN** an already-`CANCELLED` document
- **WHEN** the withdrawal is requested again
- **THEN** the request succeeds, and `approval_log` still holds exactly one `CANCEL` row for it

#### Scenario: Holds are still released

- **GIVEN** a withdrawn document that held budget and quota reservations
- **WHEN** the withdrawal completes
- **THEN** every reservation is released, as it was before this act was recorded

#### Scenario: The withdrawal is announced

- **WHEN** a document is withdrawn
- **THEN** a `document.cancelled` event is emitted after commit, carrying the document, the
  requester and the step it was withdrawn from

### Requirement: The Approvers Holding A Withdrawn Document Are Told

When a document is withdrawn while `SUBMITTED` or `IN_APPROVAL`, the system SHALL notify the actors
who were eligible to act on its current step that it was withdrawn and by whom.

The eligible actors SHALL be resolved from the step the document was on, because after the status
becomes `CANCELLED` there is no current step to resolve them from and the approval inbox — which
lists documents by `IN_APPROVAL` — no longer contains the item. An approver whose worklist loses an
entry SHALL be told why rather than discovering it on a refused approval.

A withdrawal from `DRAFT` SHALL notify nobody: the document reached no approver.

Notification failure SHALL NOT roll back the withdrawal or its `approval_log` row.

#### Scenario: The pending approvers are notified

- **GIVEN** a document in `IN_APPROVAL` whose current step resolves to two eligible approvers
- **WHEN** the creator withdraws it
- **THEN** both are notified that the document was withdrawn, and by whom

#### Scenario: A withdrawn draft notifies nobody

- **GIVEN** a `DRAFT` document
- **WHEN** its creator withdraws it
- **THEN** no approval notification is produced

#### Scenario: A failed notification does not undo the withdrawal

- **GIVEN** a document being withdrawn
- **WHEN** notification fails
- **THEN** the document is `CANCELLED` and its `CANCEL` row stands

## MODIFIED Requirements

### Requirement: Configuration-Driven Holds

Whether submit creates budget and quota holds SHALL be driven by the `document_type`
flags `requires_budget` and `requires_quota` — not by hardcoded per-type logic
(invariant 7). When `requires_budget` is true, submit SHALL reserve budget per line
grouped by `budget_id`; when `requires_quota` is true, submit SHALL reserve quota. On
cancel or reject the system SHALL release all of the document's budget and quota holds.

The release SHALL run after the transaction that records the terminal transition, and SHALL remain
idempotent, so recording the act and releasing what it held stay separable and a retry credits
nothing twice.

#### Scenario: Non-budget, non-quota type creates no holds

- **GIVEN** a document type with `requires_budget = false` and `requires_quota = false`
- **WHEN** a document of that type is submitted
- **THEN** no `budget_txn` and no `quota_usage` rows are created

#### Scenario: Budget type reserves per line

- **GIVEN** a `requires_budget` document with two lines on two different budgets
- **WHEN** it is submitted
- **THEN** one RESERVE is recorded against each budget for that line's base amount

#### Scenario: Cancel releases all holds

- **GIVEN** a submitted document holding budget (and/or quota) reservations
- **WHEN** it is cancelled
- **THEN** every reservation is released (budget RELEASE and quota RELEASE rows)
