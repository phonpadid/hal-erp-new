## MODIFIED Requirements

### Requirement: Reject Returns and Releases

On rejection the system SHALL set the document to REJECTED, release reserved budget
and quota, and allow the requester to revise and resubmit — unless the document already
has a recorded `payment` (see below), in which case resubmission is refused until that
payment's recovery flag is resolved.

A resubmission SHALL resolve and record a fresh route from the configuration in force at that
moment, and SHALL mark the previous route's rows superseded rather than deleting them, so each
attempt keeps the record of the chain it actually ran.

Marking the previous rows superseded SHALL be durable in the database **before** the replacement
rows are written, within the same transaction. `document_approval_step` carries a partial unique
key on `(document_id, step_no)` where `superseded_at IS NULL`; a replacement row inserted while its
predecessor is still live violates that key, the whole routing transaction rolls back, and the
document is left `SUBMITTED` holding a reservation with no route and no approver. The ordering SHALL
be stated by the code rather than inherited from whatever order the ORM happens to flush a unit of
work in, because "supersede, then replace" is the rule the unique key expresses and an ORM's flush
order is not part of that contract.

A resubmission whose route cannot be written SHALL leave the document `SUBMITTED` and SHALL be
reported at error level, naming the document and the holds it is carrying. It SHALL NOT be
discarded at a log level the application does not enable: a document holding budget in nobody's
queue is invisible to every user of the product, so the server log is the only place its existence
can be known.

When a budget plan (`post_action` `ACTIVATE_BUDGET`) reaches a TERMINAL unapproved outcome —
rejection, or withdrawal by its requester — the system SHALL additionally set every `budget`
referenced by the document's `budget_movement` rows from `DRAFT` to `REJECTED`, in the same
transaction as the terminal transition. Nothing is released for such a document: a plan's type has
`requires_budget` `false`, so it never held a reservation. The rows are marked rather than deleted —
`budget_movement.to_budget_id` references them, and the record of what was proposed and turned down
is the reason budgets are routed through approval at all.

This marking SHALL be tied to the terminal outcome and SHALL NOT be performed by hold release. A
RETURN releases every hold exactly as a rejection does, but it is not a verdict: the document goes
back to its requester to be corrected and resubmitted, and marking the budgets would destroy the
very lines the return asked them to correct. A returned plan's budgets SHALL therefore remain
`DRAFT`.

When the document being rejected already has a `payment` row (recorded early at a step whose
`requires_payment_slip` was true, per `payment-handoff`'s "Record Payment and FX Gain/Loss"), the
release of reserved budget and quota SHALL proceed exactly as for any other rejection — in full,
unconditionally — because that `payment` row never caused a `budget_txn` to be written and there is
nothing to reconcile on the budget ledger. What changes is that the system SHALL, in the same
transaction as the terminal transition, mark that `payment` row `recovery_status = PENDING_RECOVERY`
or SHALL be routed into `payment-recovery`, because real money already left the company for this
submission and a clean, fully-released reservation would otherwise read as if nothing had been
spent. A document carrying an unresolved `PENDING_RECOVERY` payment SHALL refuse resubmission —
`payment.document_id` is unique, so a stale row from the rejected attempt cannot simply be
superseded the way a route is, and a real financial exception SHALL block forward motion until a
person resolves it rather than being routed around automatically.

#### Scenario: Reject releases holds

- **GIVEN** a document holding budget/quota reservations
- **WHEN** an approver rejects it
- **THEN** it becomes `REJECTED` and all reservations are released

#### Scenario: Rejected document can be resubmitted

- **GIVEN** a rejected document with no recorded payment
- **WHEN** the requester edits and resubmits it
- **THEN** it re-enters routing from the first step with a fresh reservation

#### Scenario: A returned document can be resubmitted

- **GIVEN** a document an approver returned, now `DRAFT`, whose first attempt left
  `document_approval_step` rows behind
- **WHEN** the requester resubmits it
- **THEN** it reaches `IN_APPROVAL` at the first applicable step, its previous route's rows are
  marked superseded, and one live row exists per applicable step

#### Scenario: A resubmission is routed by current configuration

- **GIVEN** a returned document whose workflow gained a step while it was in `DRAFT`
- **WHEN** it is resubmitted
- **THEN** its new route includes that step, and the superseded route still shows the chain the
  first attempt ran

#### Scenario: A route that cannot be written is reported, not swallowed

- **GIVEN** a submitted document whose route write fails
- **WHEN** the auto-start listener handles the failure
- **THEN** the failure is logged at error level naming the document, rather than at a level the
  application does not enable

#### Scenario: Rejecting a budget plan marks its proposed budgets REJECTED

- **GIVEN** a submitted budget plan carrying `DRAFT` budgets
- **WHEN** an approver rejects it
- **THEN** every budget the plan references has `status` `REJECTED` in the same transaction that
  marks the document `REJECTED`
- **AND** no budget release row is written

#### Scenario: Withdrawing a budget plan marks its proposed budgets REJECTED

- **GIVEN** a submitted budget plan carrying `DRAFT` budgets
- **WHEN** the requester withdraws it
- **THEN** every budget the plan references has `status` `REJECTED` in the same transaction that
  marks the document `CANCELLED`

#### Scenario: Returning a budget plan releases holds without rejecting its budgets

- **GIVEN** a submitted budget plan carrying `DRAFT` budgets
- **WHEN** an approver returns it
- **THEN** the document is `DRAFT` with its requester, every hold it carried is released, and every
  budget it references is still `DRAFT`

#### Scenario: Rejecting a document with an early-recorded payment still releases in full

- **GIVEN** a document `IN_APPROVAL` with a `payment` row recorded at its gated step and a live
  budget reservation
- **WHEN** a later step rejects it
- **THEN** the document becomes `REJECTED` and the full reservation is released, exactly as when no
  payment exists

#### Scenario: Rejecting a document with an early-recorded payment flags it for recovery

- **GIVEN** the same rejection
- **WHEN** the terminal transition commits
- **THEN** the document's `payment` row is marked `PENDING_RECOVERY` in the same transaction

#### Scenario: A document flagged for recovery cannot be resubmitted

- **GIVEN** a rejected document whose payment is `PENDING_RECOVERY`
- **WHEN** the requester attempts to revise and resubmit it
- **THEN** the resubmission is refused, naming the unresolved payment as the reason

#### Scenario: Resolving the recovery flag unblocks resubmission

- **GIVEN** a rejected document whose payment was `PENDING_RECOVERY` and has since been marked
  resolved by accounting
- **WHEN** the requester resubmits it
- **THEN** the resubmission proceeds exactly as for a rejected document with no payment
