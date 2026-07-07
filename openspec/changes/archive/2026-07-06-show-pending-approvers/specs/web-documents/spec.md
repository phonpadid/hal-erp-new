## ADDED Requirements

### Requirement: Pending Approver Entry in the Detail Timeline

The document detail view SHALL show, after the approval history, a **pending** entry for a
document that is `IN_APPROVAL`, describing who the document is waiting on. The entry SHALL show
the current step (number/name) and its approval mode, and SHALL list the approver(s) from the
pending-step approver read: for a role-targeted step, the role name together with the eligible
holders; for a user-targeted step, the named approver. When an eligible actor is a delegate, the
entry SHALL indicate the principal they act for. The pending entry SHALL be shown only to users
the read returns it to (participants); other viewers SHALL see the history without it. The entry
is informational and SHALL NOT imply the current viewer can act (action affordances remain gated
by their existing permission and step eligibility).

#### Scenario: Requester sees the pending step and its approvers

- **GIVEN** the requester opens the detail of their `IN_APPROVAL` document
- **WHEN** the timeline renders
- **THEN** a pending entry after the history shows the current step and the approver(s) it is
  waiting on

#### Scenario: Role-targeted step shows role name and people

- **GIVEN** the current step targets a role held by two users
- **WHEN** the requester views the pending entry
- **THEN** it shows the role name and both eligible people

#### Scenario: No pending entry once the document leaves approval

- **GIVEN** a document that is `APPROVED` (or `DRAFT`)
- **WHEN** the detail timeline renders
- **THEN** no pending entry is shown, only the history
