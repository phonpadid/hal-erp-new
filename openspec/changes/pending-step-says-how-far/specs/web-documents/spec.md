## MODIFIED Requirements

### Requirement: Pending Approver Entry in the Detail Timeline

The document detail view SHALL show, after the approval history, a **pending** entry for a
document that is `IN_APPROVAL`, describing who the document is waiting on. The entry SHALL show
the current step as a POSITION within the route — the step number out of the route's total — with
the step name when it has one and its approval mode, and SHALL list the approver(s) from the
pending-step approver read: for a role-targeted step, the role name together with the eligible
holders; for a user-targeted step, the named approver. When an eligible actor is a delegate, the
entry SHALL indicate the principal they act for.

A bare step number is not enough: `ຂັ້ນທີ 2` reads the same whether the route has three steps or
seven. The total SHALL come from the server's read and SHALL NOT be counted in the client; when
the read returns no total the entry SHALL fall back to the bare step rather than render an
incomplete position.

The entry SHALL be shown to every reader of the document, not only to its creator and approvers:
a colleague chasing a document needs to know whose desk it is on, and a reader who will see each
approver's name in the history the moment they act gains nothing from being told only that it is
"in approval". The entry is informational and SHALL NOT imply the current viewer can act (action
affordances remain gated by their existing permission and step eligibility).

#### Scenario: Requester sees the pending step and its approvers

- **GIVEN** the requester opens the detail of their `IN_APPROVAL` document
- **WHEN** the timeline renders
- **THEN** a pending entry after the history shows the current step and the approver(s) it is
  waiting on

#### Scenario: The pending entry states the position in the route

- **GIVEN** an `IN_APPROVAL` document at step 2 of a six-step route
- **WHEN** the detail renders
- **THEN** the pending entry reads step 2 of 6, beside whoever is holding it

#### Scenario: A named step keeps its name alongside the position

- **GIVEN** the current step carries a step name
- **WHEN** the pending entry renders
- **THEN** it shows the position and the step's name

#### Scenario: No total means no invented position

- **GIVEN** a pending read that returned no total
- **WHEN** the pending entry renders
- **THEN** it shows the bare step number and never a partial position

#### Scenario: Role-targeted step shows role name and people

- **GIVEN** the current step targets a role held by two users
- **WHEN** the requester views the pending entry
- **THEN** it shows the role name and both eligible people

#### Scenario: A reader who did not raise it sees who has it

- **GIVEN** a user who may read an `IN_APPROVAL` document they neither raised nor approve
- **WHEN** the timeline renders
- **THEN** the pending entry is shown, and no action affordance is offered

#### Scenario: No pending entry once the document leaves approval

- **GIVEN** a document that is `APPROVED` (or `DRAFT`)
- **WHEN** the detail timeline renders
- **THEN** no pending entry is shown, only the history
