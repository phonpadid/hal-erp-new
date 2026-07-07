## ADDED Requirements

### Requirement: Routing Lifecycle and Step Completion

The system SHALL route a SUBMITTED document through the applicable steps of its bound
workflow — those whose `amount_min`/`amount_max` band contains the document's
`base_total_amount` — in `step_no` order, setting the document to `IN_APPROVAL` while
routing. Step completion SHALL be derived from `approval_log`: a SEQUENTIAL or
PARALLEL_ANY step completes on the first APPROVE; a PARALLEL_ALL step completes only when
every eligible approver has approved. When the last applicable step completes the document
SHALL become `APPROVED`.

#### Scenario: Amount band includes the higher step

- **GIVEN** a workflow whose final step has `amount_min` 500000
- **WHEN** a document with `base_total_amount` 600000 routes
- **THEN** that step is part of the routing; a 400000 document skips it

#### Scenario: Parallel-any advances on first approval

- **GIVEN** a PARALLEL_ANY step with three eligible approvers
- **WHEN** one approves
- **THEN** the step is satisfied and routing advances

#### Scenario: Parallel-all waits for everyone

- **GIVEN** a PARALLEL_ALL step with two eligible approvers
- **WHEN** only one has approved
- **THEN** the step is not yet complete and routing does not advance

### Requirement: Delegation and Self-Approval Enforcement

A step approver SHALL be resolved from `approver_user_id` or the holders of
`approver_role_id` in the document's company. An active `approval_delegation` (date range,
document-type scope, amount limit) SHALL reroute the item to the delegate, recording
`delegated_from`. The system MUST block an approval when the acting user — or the
delegator they act for — is the document's creator (no self-approval, directly or via
delegation), and MUST NOT follow a delegate's own delegation (no chaining).

#### Scenario: Pending item routes to the delegate

- **GIVEN** an approver with an active delegation to a colleague
- **WHEN** the document enters that approver's step
- **THEN** the colleague may approve, and the log records `delegated_from` = the approver

#### Scenario: The creator cannot approve their own document

- **WHEN** the document's creator is the assigned approver (directly or as a delegate)
- **THEN** their approval is blocked

#### Scenario: Delegation does not chain

- **GIVEN** A delegates to B and B delegates to C
- **WHEN** an item in A's step is routed
- **THEN** B may act but C is not reached through A→B→C

### Requirement: Authorized, Append-Only Actions with Hold Release

Every approval action SHALL require `DOC_APPROVE`, be recorded in the append-only
`approval_log` (never modified), and carry actor, action, timestamp, and remark. REJECT
SHALL set the document `REJECTED` and release its reserved budget and quota; RETURN SHALL
set it `DRAFT` and release holds so the requester can revise and resubmit.

#### Scenario: Reject releases holds

- **GIVEN** a document holding budget/quota reservations
- **WHEN** an approver rejects it
- **THEN** it becomes `REJECTED` and all reservations are released

#### Scenario: The audit trail is immutable

- **WHEN** an attempt is made to update an existing `approval_log` row
- **THEN** it is rejected (append-only)

### Requirement: Post-Action Execution on Full Approval

On full approval the system SHALL run the document type's `post_action` atomically with
the terminal transition and a bounded retry, then mark the document `COMPLETED`. A
`CUT_BUDGET` action SHALL convert reservations to actuals (`settle`); `TRANSFER` /
`ADJUST_INCREASE` / `ADJUST_DECREASE` SHALL execute the document's `budget_movement`. If
the post-action ultimately fails the terminal transition SHALL roll back, leaving the
document not stuck (still routable), never half-applied.

#### Scenario: Budget document settles on approval

- **GIVEN** an approved `CUT_BUDGET` document that reserved 100000 on a budget
- **WHEN** the post-action runs
- **THEN** an ACTUAL is recorded and the reservation is converted

#### Scenario: A failing post-action does not half-apply

- **WHEN** the post-action throws after retries
- **THEN** the APPROVED/COMPLETED transition is rolled back and no partial ledger effect remains
