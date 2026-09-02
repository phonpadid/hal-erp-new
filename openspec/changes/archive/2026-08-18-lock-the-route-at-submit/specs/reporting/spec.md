# reporting

## MODIFIED Requirements

### Requirement: Pending-Approval Aging and Bottleneck Report

The system SHALL provide a report of all documents currently `IN_APPROVAL` in the active company —
not limited to documents the caller may act on — showing for each the current step, the eligible
approver(s) the step is waiting on, the document age (since submit), the time-in-step, and the SLA
due time and overdue flag (computed with the working-time calendar). The report SHALL also provide
roll-ups that group the pending documents by approver and by step so approval bottlenecks are
visible.

The current step's name, SLA hours and time-in-step SHALL be read from the step recorded on the
document's route: time-in-step is that step's `started_at`, not the most recent approval-log row at
or below the current step. That derivation was an approximation built from the only evidence
available before a step had a start time, and it misreports a step reached by escalation — which
logs against the step it left — and the first step of a resubmission.

#### Scenario: Pending document shows step, approver, and aging

- **WHEN** a user runs the approval-aging report
- **THEN** each pending document shows its current step, the resolved eligible approver(s), its
  document age, its time-in-step, and its SLA/overdue status

#### Scenario: Time-in-step is the step's own elapsed time

- **GIVEN** a document whose second step opened two hours ago after a first step that took two days
- **WHEN** the report is run
- **THEN** its time-in-step is two hours

#### Scenario: Report is not limited to the caller's actionable items

- **WHEN** a document is pending on an approver other than the caller
- **THEN** it still appears in the report (the report shows the true waiting set, not the caller's
  inbox)

#### Scenario: Bottlenecks roll up by approver and by step

- **WHEN** the user views the report's roll-ups
- **THEN** pending counts (and oldest age) are grouped by approver and by step, surfacing where
  approvals are stuck

#### Scenario: Overdue respects the working-time calendar

- **WHEN** a step's SLA elapses across a weekend or company holiday
- **THEN** the overdue flag is computed using the working-time calendar, not raw elapsed hours
