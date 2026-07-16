## MODIFIED Requirements

### Requirement: Post-Action Execution on Full Approval

On full approval the system SHALL run the document type's `post_action` atomically with
the terminal transition and a bounded retry, then mark the document `COMPLETED`. A
`CUT_BUDGET` action SHALL convert reservations to actuals (`settle`) AND signal payment-ready
(emit a `payment.ready` event for the settled document); `TRANSFER` /
`ADJUST_INCREASE` / `ADJUST_DECREASE` SHALL execute the document's `budget_movement`; a
`CREATE_SUCCESSOR` action SHALL create a DRAFT successor document for **each** successor pairing of
the approved document's type marked `auto_create=true` in `document_type_ref` (reusing `createFrom`),
and SHALL be a logged no-op when no such pairing exists. If the post-action ultimately
fails the terminal transition SHALL roll back, leaving the document not stuck (still routable),
never half-applied.

#### Scenario: Budget document settles on approval

- **GIVEN** an approved `CUT_BUDGET` document that reserved 100000 on a budget
- **WHEN** the post-action runs
- **THEN** an ACTUAL is recorded, the reservation is converted, and a `payment.ready` signal is emitted

#### Scenario: CREATE_SUCCESSOR auto-creates a draft per auto_create pairing

- **GIVEN** an approved document whose type has one or more successor pairings marked `auto_create=true`
- **WHEN** the post-action runs
- **THEN** a DRAFT successor document referencing the source is created for each such pairing (vendor, currency, and lines copied)

#### Scenario: CREATE_SUCCESSOR with no auto_create pairing is a no-op

- **GIVEN** an approved document whose type has no successor pairing marked `auto_create=true`
- **WHEN** the `CREATE_SUCCESSOR` post-action runs
- **THEN** it does nothing (logged) and the approval still completes

#### Scenario: A failing post-action does not half-apply

- **WHEN** the post-action throws after retries
- **THEN** the APPROVED/COMPLETED transition is rolled back and no partial ledger effect remains
