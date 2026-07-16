## MODIFIED Requirements

### Requirement: Post-Action Execution on Full Approval

On full approval the system SHALL run the document type's `post_action` atomically with
the terminal transition and a bounded retry, then mark the document `COMPLETED`. A
`CUT_BUDGET` action SHALL convert reservations to actuals (`settle`) AND signal payment-ready
(emit a `payment.ready` event for the settled document); `TRANSFER` /
`ADJUST_INCREASE` / `ADJUST_DECREASE` SHALL execute the document's `budget_movement`; a
`CREATE_SUCCESSOR` action SHALL **record a `PENDING` obligation for** each successor pairing of
the approved document's type marked `auto_create=true` in `document_type_ref`, **which a sweep
outside this transaction later fulfils by `createFrom`**,
and SHALL be a logged no-op when no such pairing exists. If the post-action ultimately
fails the terminal transition SHALL roll back, leaving the document not stuck (still routable),
never half-applied.

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
