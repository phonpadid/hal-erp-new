# document-intake Specification

## Purpose
The finance intake register: the record that a document physically reached the desk of the office
that has to file it. A document is receivable once its recorded route has put it in front of the
reader — never because of its status, its role name, or its department code — and receipt is kept
as an append-only `document_intake_log` from which the received state is derived, so a reversal is
a new row and not an erasure. Receiving is gated on `DOC_INTAKE_RECEIVE` and reversing on
`DOC_INTAKE_REVERSE`, can be done for a batch of documents at once, and never touches the approval
route, the budget, or a quota.

## Requirements
### Requirement: A Document Is Receivable Once It Has Been At The Reader's Desk

The system SHALL treat a document as receivable by a user when EITHER of the following holds:

1. Its live recorded route has opened a step that names that user as a principal — that is, a
   `document_approval_step_actor` row exists for that user against a `document_approval_step` of
   the document whose `superseded_at` is null. Because those rows are written when a step OPENS and
   not before, an unopened step SHALL NOT make a document receivable.
2. An `approval_log` row records that user as the actor on the document, with any `action` other
   than `CANCEL`.

Closing a step SHALL NOT withdraw receivability: an officer who signed their step, and only later
noticed they never registered the paper, SHALL still be able to register it, whatever step the
document has since moved to and whether or not it has finished.

The second source exists because the first cannot survive a re-route: a resubmission calls
`materialise`, which supersedes every live `document_approval_step` row and with it every actor row
of the previous attempt. `approval_log` is append-only (invariant 2) and therefore outlasts it.

`CANCEL` SHALL be excluded from the second source: it records the REQUESTER withdrawing their own
document, not a reviewer the route delivered it to.

Receivability SHALL NOT be derived from `document.status`, from `document.current_step_no`, from
`role.code`, or from `department.dept_code`. A document reaches the finance department because the
company configured a step that routes there (invariant 7), and authorization is by permission code
rather than role name (invariant 5).

A role-targeted step records every holder of that role in the company as a principal when it opens,
so every holder SHALL be able to receive the documents that reached that step. Receiving a document
SHALL NOT advance, block, or otherwise alter its approval route, and SHALL NOT confer any approval
authority.

#### Scenario: A document that reached the reader's step is receivable

- **GIVEN** a document whose route has opened a step naming the current user as a principal
- **WHEN** the user lists what they may receive
- **THEN** the document is included, whatever its `status` and `current_step_no`

#### Scenario: A document whose route has not yet reached the reader is not receivable

- **GIVEN** a document whose route includes a later step naming the current user, not yet opened
- **WHEN** the user lists what they may receive
- **THEN** the document is not included, because no actor row exists for that step

#### Scenario: A draft is never receivable

- **GIVEN** a DRAFT document, which has no recorded route
- **WHEN** any user lists what they may receive
- **THEN** the document is not included

#### Scenario: A document still in approval is receivable

- **GIVEN** an IN_APPROVAL document whose route has opened a step naming the current user
- **WHEN** the user lists what they may receive
- **THEN** the document is included, because arrival is a routing fact and not an outcome

#### Scenario: Every holder of a role-targeted step may receive

- **GIVEN** a step targeting a role held by two users, opened on a document
- **WHEN** either holder lists what they may receive
- **THEN** the document is included for both

#### Scenario: A superseded route step alone does not make a document receivable

- **GIVEN** a document re-routed after a return, whose earlier step naming the user carries a
  non-null `superseded_at`, and on which the user recorded no action
- **WHEN** the user lists what they may receive
- **THEN** that superseded step is ignored

#### Scenario: The officer who signed it can still register it afterwards

- **GIVEN** a document whose step naming the user has been approved and closed, and whose route has
  moved to a later step
- **WHEN** the user receives it
- **THEN** it is received

#### Scenario: A finished document can still be registered

- **GIVEN** a COMPLETED document whose route opened a step naming the user
- **WHEN** the user receives it
- **THEN** it is received

#### Scenario: A resubmission does not strip the signer of what is on their desk

- **GIVEN** a document the user approved, later returned and resubmitted, so every route step of
  the previous attempt carries a `superseded_at`
- **WHEN** the user receives it
- **THEN** it is received, because their `approval_log` row outlived the re-route

#### Scenario: Withdrawing one's own document is not arrival

- **GIVEN** a user whose only `approval_log` row on the document is a `CANCEL`, and whom no live
  route step names
- **WHEN** they attempt to receive it
- **THEN** it is refused

### Requirement: Receipt Is Recorded in an Append-Only Log and the State Is Derived

The system SHALL record every intake act as a row in `document_intake_log`, carrying `company_id`,
`document_id`, `action` (`RECEIVE` or `REVERSE`), `actor_id`, `acted_at`, and an optional `note`.

`document_intake_log` SHALL be append-only: no row is ever updated or deleted, and a reversal is a
new `REVERSE` row rather than the removal of the `RECEIVE` it reverses (invariant 2).

A document's received state SHALL be derived as: received when its most recent
`document_intake_log` row is a `RECEIVE`, and not received when it has no rows or its most recent
row is a `REVERSE`. The received state SHALL NOT be stored on `document`.

Every row SHALL carry the `company_id` of the document it records, and reads SHALL be scoped to
the active company (invariant 1).

#### Scenario: Receiving writes one row and derives the state

- **WHEN** a user receives a document that has never been received
- **THEN** one `RECEIVE` row is written naming that user and the time, and the document reads as
  received

#### Scenario: Reversal leaves the receipt on the record

- **GIVEN** a received document
- **WHEN** an authorized user reverses the receipt
- **THEN** a `REVERSE` row is appended, the original `RECEIVE` row is unchanged, and the document
  reads as not received

#### Scenario: A document can be received again after a reversal

- **GIVEN** a document whose latest row is a `REVERSE`
- **WHEN** a user with `DOC_INTAKE_RECEIVE` receives it
- **THEN** a second `RECEIVE` row is appended and the document reads as received

#### Scenario: Intake rows never cross companies

- **GIVEN** a user whose active company is A
- **WHEN** they read intake state
- **THEN** only `document_intake_log` rows whose `company_id` is A are considered

### Requirement: Receiving and Reversing Are Gated by Separate Permission Codes

The system SHALL gate registering a receipt on `DOC_INTAKE_RECEIVE` and reversing one on
`DOC_INTAKE_REVERSE`. The two SHALL be distinct codes, and holding `DOC_INTAKE_RECEIVE` SHALL NOT
permit a reversal.

Neither SHALL be `DOC_RECEIVE`, which already authorizes goods receipt against a purchase order's
lines and means a different thing.

Holding `DOC_INTAKE_RECEIVE` SHALL NOT be sufficient on its own: the document MUST also be
receivable by that user. Authorization SHALL be enforced on the server; any client-side hiding is
UX only.

#### Scenario: Receiving without the code is refused

- **WHEN** a user without `DOC_INTAKE_RECEIVE` attempts to receive a document
- **THEN** the request is refused and no row is written

#### Scenario: The code alone does not reach an unreached document

- **GIVEN** a user holding `DOC_INTAKE_RECEIVE` and a document whose route has never opened a step
  naming them
- **WHEN** they attempt to receive it
- **THEN** the request is refused and no row is written

#### Scenario: Reversal needs its own code

- **GIVEN** a received document and a user holding `DOC_INTAKE_RECEIVE` but not
  `DOC_INTAKE_REVERSE`
- **WHEN** they attempt to reverse the receipt
- **THEN** the request is refused and no row is written

### Requirement: A Batch of Receipts Reports Each Document and Survives One Refusal

The system SHALL accept a batch of document ids to receive in one request and SHALL answer with a
per-document outcome: received, or a refusal naming its reason — already received, not reached by
this user, or not found in the active company.

A refusal for one document SHALL NOT prevent the others in the batch from being received. Each
document SHALL be settled in its own transaction so no sibling's row is rolled back.

An id belonging to another company SHALL be reported as not found and SHALL NOT be received
(invariant 1).

#### Scenario: One already-received document does not lose the batch

- **GIVEN** twenty ticked documents, one of which a colleague already received
- **WHEN** the user receives the batch
- **THEN** nineteen are received, and the response names the twentieth as already received

#### Scenario: A document from another company is not found

- **GIVEN** a batch containing a document id belonging to another company
- **WHEN** the user receives the batch
- **THEN** that id is reported as not found and no row is written for it

#### Scenario: Receiving an already-received document is refused, not repeated

- **GIVEN** a document that reads as received
- **WHEN** a user receives it again
- **THEN** it is reported as already received and no second `RECEIVE` row is written

### Requirement: Concurrent Receipts of One Document Produce One Receipt

The system SHALL take the document row under `LockMode.PESSIMISTIC_WRITE` before reading that
document's latest intake row, so the read-then-decide pair serialises across concurrent callers.

When two users receive the same document simultaneously, exactly one `RECEIVE` row SHALL be
written; the other request SHALL be answered as already received.

#### Scenario: Two officers press receive at the same moment

- **GIVEN** a receivable document and two users holding `DOC_INTAKE_RECEIVE`
- **WHEN** both receive it concurrently
- **THEN** exactly one `RECEIVE` row exists afterwards and the losing request reports already
  received
