## ADDED Requirements

### Requirement: Pending-Step Approver Read

The system SHALL expose a read-only projection of the approvers a document is currently waiting
on. For a document whose status is `IN_APPROVAL`, the read SHALL identify the applicable step
whose `step_no` equals the document's `current_step_no` and return that step's `step_no`,
`step_name`, `approve_mode`, and the list of eligible actors resolved by the same rules the
router uses — the targeted user, or the validity-dated holders of the targeted role, plus active
one-hop delegates (invariant 8; delegation SHALL NOT be chained). Each actor SHALL be returned
as its user id and a display name, with the principal identified when the actor is a delegate.
When the step targets a role, the read SHALL also return the role name alongside the expanded
holder list. For a document not in approval, the read SHALL return an empty/absent pending
result rather than an error.

Visibility SHALL require `DOC_VIEW` and the active-company scope, AND SHALL be limited to
participants of the document: the document's creator, or a user who is an eligible approver in
any applicable step of the document's workflow. A non-participant request SHALL be rejected as
not found. The read SHALL NOT change who may act on the document.

#### Scenario: Requester sees who the document is waiting on

- **GIVEN** a document the caller created that is `IN_APPROVAL` at step 1
- **WHEN** the caller requests the pending-step approvers
- **THEN** step 1's number, name, `approve_mode`, and its eligible approvers (user id + name)
  are returned

#### Scenario: Role-targeted step returns role name and expanded holders

- **GIVEN** the current step targets a company role held by two users
- **WHEN** a participant requests the pending-step approvers
- **THEN** the response includes the role name and both holders as eligible approvers

#### Scenario: Active delegate is included and attributed

- **GIVEN** an eligible approver has an active delegation covering this document
- **WHEN** a participant requests the pending-step approvers
- **THEN** the delegate appears as an eligible actor with the principal recorded as who they act
  for, and no second-hop delegate is included

#### Scenario: Non-participant cannot see approver identities

- **GIVEN** a `DOC_VIEW` user who is neither the creator nor an eligible approver of any step
- **WHEN** that user requests the pending-step approvers
- **THEN** the request is rejected as not found

#### Scenario: Document not in approval yields no pending approvers

- **GIVEN** a document in `DRAFT` (or a terminal status)
- **WHEN** a participant requests the pending-step approvers
- **THEN** an empty/absent pending result is returned, not an error
