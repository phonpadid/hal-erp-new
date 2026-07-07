## ADDED Requirements

### Requirement: Delegation Listing and Revocation

The system SHALL let a `WORKFLOW_MANAGE` user list the active company's approval delegations and
cancel a delegation. Cancelling SHALL set its status so the approver resolver no longer applies it
(it honors only active delegations), while preserving the record. Both operations SHALL be scoped
to the active company. The one-hop / no-chaining rule is unchanged — it remains enforced by the
resolver at act time, not by this configuration surface.

#### Scenario: List delegations for the active company

- **WHEN** a `WORKFLOW_MANAGE` user requests the delegations
- **THEN** the active company's delegations are returned (and not those of another company)

#### Scenario: Cancelling stops a delegation from applying

- **WHEN** a `WORKFLOW_MANAGE` user cancels an active delegation
- **THEN** its status is no longer active and the resolver does not apply it to subsequent
  approvals
