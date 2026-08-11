## MODIFIED Requirements

### Requirement: Reject Returns and Releases
On rejection the system SHALL set the document to REJECTED, release reserved budget
and quota, and allow the requester to revise and resubmit.

When the rejected document is a budget plan (`post_action` `ACTIVATE_BUDGET`), rejection SHALL
additionally set every `budget` referenced by the document's `budget_movement` rows from `DRAFT` to
`REJECTED`, in the same transaction as the terminal transition. Nothing is released for such a
document: a plan's type has `requires_budget` `false`, so it never held a reservation. The rows are
marked rather than deleted — `budget_movement.to_budget_id` references them, and the record of what
was proposed and turned down is the reason budgets are routed through approval at all.

#### Scenario: Rejected document can be resubmitted
- GIVEN a rejected document
- WHEN the requester edits and resubmits it
- THEN it re-enters routing from the first step with a fresh reservation

#### Scenario: Rejecting a budget plan marks its proposed budgets REJECTED

- **GIVEN** a submitted budget plan carrying `DRAFT` budgets
- **WHEN** an approver rejects it
- **THEN** every budget the plan references has `status` `REJECTED` in the same transaction that
  marks the document `REJECTED`
- **AND** no budget release row is written

### Requirement: Post-Action Execution on Full Approval

On full approval the system SHALL run the document type's `post_action` atomically with
the terminal transition and a bounded retry, then mark the document `COMPLETED`. A
`CUT_BUDGET` action SHALL convert reservations to actuals (`settle`) AND signal payment-ready
(emit a `payment.ready` event for the settled document); `TRANSFER` /
`ADJUST_INCREASE` / `ADJUST_DECREASE` SHALL execute the document's `budget_movement`; an
`ACTIVATE_BUDGET` action SHALL activate every budget the document's `budget_movement` rows
reference; a `CREATE_SUCCESSOR` action SHALL **record a `PENDING` obligation for** each successor
pairing of the approved document's type marked `auto_create=true` in `document_type_ref`, **which a
sweep outside this transaction later fulfils by `createFrom`**,
and SHALL be a logged no-op when no such pairing exists. If the post-action ultimately
fails the terminal transition SHALL roll back, leaving the document not stuck (still routable),
never half-applied.

`ACTIVATE_BUDGET` is the first action that reads **many** `budget_movement` rows for one document
rather than exactly one. `TRANSFER` and the two `ADJUST` actions each execute the single movement
their document carries and SHALL continue to do so; `ACTIVATE_BUDGET` SHALL read all of them, and
SHALL activate them as one unit so a fiscal year is never left partly in force. It writes no
`budget_txn` row, because a budget's opening figure is `budget.amount_total` rather than a
transaction (invariant 3).

**`CREATE_SUCCESSOR` SHALL NOT create the successor document inside this transaction**, because
`createFrom` requires the source to be `APPROVED` or `COMPLETED` — a state it has not reached
while the transaction that grants it is still open — and because a downstream type's health MUST
NOT be able to veto an approval its approvers already granted. Recording the obligation is what
satisfies the never-half-applied rule: the document and everything it owes commit together, so a
`COMPLETED` document always carries a durable record of the successor it owes. A failure to record
the obligation SHALL roll the terminal transition back like any other post-action failure; a
failure to *fulfil* it later SHALL NOT, and SHALL instead become a visible `FAILED` obligation.

#### Scenario: Budget document settles on approval

- **GIVEN** an approved `CUT_BUDGET` document that reserved 100000 on a budget
- **WHEN** the post-action runs
- **THEN** the reservation is settled to an actual and a `payment.ready` event is emitted

#### Scenario: A budget plan activates every line it carries

- **GIVEN** an approved document whose type has `post_action` `ACTIVATE_BUDGET`, carrying three
  `budget_movement` rows
- **WHEN** the post-action runs
- **THEN** all three referenced budgets become `ACTIVE` in the same transaction that marks the
  document `COMPLETED`

#### Scenario: A plan that fails to activate leaves the approval undone

- **GIVEN** an approved budget plan whose activation cannot complete
- **WHEN** the bounded retry is exhausted
- **THEN** the terminal transition rolls back, no budget on the plan is `ACTIVE`, and the document
  is not left `COMPLETED`

#### Scenario: A successor obligation commits with the approval

- **GIVEN** an approved document whose type is `CREATE_SUCCESSOR` with an `auto_create` pairing
- **WHEN** the post-action runs
- **THEN** a `PENDING` obligation is recorded in the same transaction that marks the document `COMPLETED`

#### Scenario: A successor that cannot be created does not undo the approval

- **GIVEN** a `COMPLETED` document whose owed successor cannot be created
- **WHEN** the sweep fails to fulfil the obligation
- **THEN** the document stays `COMPLETED` and the obligation is recorded as failed rather than rolled back

#### Scenario: Failing to record the obligation rolls the approval back

- **GIVEN** an approval whose `CREATE_SUCCESSOR` post-action cannot write its obligation
- **WHEN** the bounded retry is exhausted
- **THEN** the terminal transition rolls back and the document is not left `COMPLETED`
