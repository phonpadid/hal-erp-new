## MODIFIED Requirements

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

The read SHALL also return the number of steps in the document's live recorded route
(`document_approval_step` rows whose `superseded_at` is null), so the current step can be stated
as a position. The count SHALL be of the RECORDED route, not of the workflow's configured steps:
a document routes on the steps recorded for it at submit, and one whose amount bands or
job-level conditions excluded some of them has fewer. Counting the configuration would tell a
requester their document has seven steps when it will only ever pass through six.

Visibility SHALL be exactly the visibility of the DOCUMENT: `DOC_VIEW`, the active-company scope,
and the caller's permission scope over that document — the same test the detail view passes. A
caller who may read the document SHALL receive the pending result; a caller who may not read the
document SHALL be rejected as not found, which is then a true statement about the document rather
than about one field of it.

The read SHALL NOT be limited to participants. Withholding it from other readers concealed the
approver's identity only until someone acted — the same reader sees that name in the approval
history the moment an approval is recorded — while removing it at the one point it is useful, to
a colleague trying to move the document along.

The read SHALL NOT change who may act on the document.

#### Scenario: Requester sees who the document is waiting on

- **GIVEN** a document the caller created that is `IN_APPROVAL` at step 1
- **WHEN** the caller requests the pending-step approvers
- **THEN** step 1's number, name, `approve_mode`, and its eligible approvers (user id + name)
  are returned

#### Scenario: Role-targeted step returns role name and expanded holders

- **GIVEN** the current step targets a company role held by two users
- **WHEN** a reader requests the pending-step approvers
- **THEN** the response includes the role name and both holders as eligible approvers

#### Scenario: Active delegate is included and attributed

- **GIVEN** an eligible approver has an active delegation covering this document
- **WHEN** a reader requests the pending-step approvers
- **THEN** the delegate appears as an eligible actor with the principal recorded as who they act
  for, and no second-hop delegate is included

#### Scenario: A reader who is neither creator nor approver still sees who has it

- **GIVEN** a `DOC_VIEW` user who may read the document but is neither its creator nor an
  eligible approver of any step
- **WHEN** that user requests the pending-step approvers
- **THEN** the current step and its eligible approvers are returned

#### Scenario: A caller who may not read the document is refused

- **GIVEN** a document outside the caller's active company or permission scope
- **WHEN** that caller requests the pending-step approvers
- **THEN** the request is rejected as not found, and the pending step is not computed

#### Scenario: Seeing who has it confers no authority to act

- **GIVEN** a reader who is not an eligible approver and has just read the pending step
- **WHEN** they attempt to act on the document
- **THEN** they are refused exactly as before

#### Scenario: The route's step count travels with the current step

- **GIVEN** a document whose recorded route has six steps, currently at step 2
- **WHEN** the pending step is read
- **THEN** the response carries the current step and a total of 6

#### Scenario: The count is of the recorded route, not the configured workflow

- **GIVEN** a workflow of three configured steps, of which the document recorded two
- **WHEN** the pending step is read
- **THEN** the total is 2

#### Scenario: Document not in approval yields no pending approvers

- **GIVEN** a document in `DRAFT` (or a terminal status)
- **WHEN** a reader requests the pending-step approvers
- **THEN** an empty/absent pending result is returned, not an error
