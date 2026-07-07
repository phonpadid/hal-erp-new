## MODIFIED Requirements

### Requirement: Post-Action Execution on Full Approval

On full approval the system SHALL run the document type's `post_action` atomically with
the terminal transition and a bounded retry, then mark the document `COMPLETED`. A
`CUT_BUDGET` action SHALL convert reservations to actuals (`settle`) AND signal payment-ready
(emit a `payment.ready` event for the settled document); `TRANSFER` /
`ADJUST_INCREASE` / `ADJUST_DECREASE` SHALL execute the document's `budget_movement`; a
`CREATE_PO` action SHALL create a DRAFT successor purchase order from the approved document
(resolving the successor type by reverse `REF_CHAIN` lookup and reusing `createFrom`), and
SHALL be a logged no-op when no single successor type resolves. If the post-action ultimately
fails the terminal transition SHALL roll back, leaving the document not stuck (still routable),
never half-applied.

#### Scenario: Budget document settles on approval

- **GIVEN** an approved `CUT_BUDGET` document that reserved 100000 on a budget
- **WHEN** the post-action runs
- **THEN** an ACTUAL is recorded, the reservation is converted, and a `payment.ready` signal is emitted

#### Scenario: CREATE_PO auto-creates a draft purchase order

- **GIVEN** an approved PR whose type `post_action` is `CREATE_PO` and whose code maps to a single
  successor type (`PO`) via the reference chain
- **WHEN** the post-action runs
- **THEN** a DRAFT `PO` document referencing the PR is created (vendor, currency, and lines copied)

#### Scenario: CREATE_PO with no resolvable successor is a no-op

- **GIVEN** an approved document whose type resolves to no single successor type
- **WHEN** the `CREATE_PO` post-action runs
- **THEN** it does nothing (logged) and the approval still completes

#### Scenario: A failing post-action does not half-apply

- **WHEN** the post-action throws after retries
- **THEN** the APPROVED/COMPLETED transition is rolled back and no partial ledger effect remains
