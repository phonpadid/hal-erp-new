## MODIFIED Requirements

### Requirement: Conditional Workflow Selection

The system SHALL bind a document to the workflow mapped to its company, department, and
document type, and SHALL include a step in routing only when the step's conditions match the
document. Step inclusion SHALL honour the step's `amount_min`/`amount_max` band against the
document's `base_total_amount`, AND a step's `workflow_step.condition_json` job-level
restriction (e.g. `{ "jobLevels": ["MANAGER"] }`) against the requester's `employee.job_level`.
A step with no job-level restriction SHALL apply to every requester. When a step restricts
job levels and the requester's `job_level` is not among them (or the requester has no
`job_level`), that step SHALL be skipped.

#### Scenario: Amount picks the longer chain

- **GIVEN** a chain whose final step has `amount_min` 500,000
- **WHEN** a document with base amount 600,000 is submitted
- **THEN** that step is included in the routing and a 400,000 document skips it

#### Scenario: Position level gates a step

- **GIVEN** a step whose `condition_json` restricts `jobLevels` to "MANAGER"
- **WHEN** a document is submitted by a requester whose `employee.job_level` is "STAFF"
- **THEN** that step is skipped, and a document from a "MANAGER" requester includes it

#### Scenario: Unrestricted step applies to everyone

- **WHEN** a step has no job-level restriction in its `condition_json`
- **THEN** it is included regardless of the requester's `job_level`

### Requirement: SLA and Escalation

The system SHALL track a working-hour SLA per step computed from `workflow_step.sla_hours`
against the company `holiday_calendar` (skipping weekends and company holidays), and SHALL
run a scheduled sweep that escalates overdue `IN_APPROVAL` steps that have no active
delegation. Escalation SHALL forward the item to the next applicable step (the schema carries
no reporting/superior relationship, so superior-based escalation is out of scope) inside a
single transaction that locks the document row, notify the new eligible actor, and append an
`ESCALATE` entry to the append-only `approval_log`. Escalation MUST NOT route the item to the
document's creator (no-self-approval still holds after reassignment) and MUST NOT modify any
existing `approval_log` row.

#### Scenario: Overdue item escalates and notifies

- **GIVEN** a step whose working-hour SLA has elapsed and no active delegation exists
- **WHEN** the escalation sweep runs
- **THEN** the item is forwarded to the next applicable step, the new actor is notified, and
  an `ESCALATE` row is appended to `approval_log`

#### Scenario: Working-day computation skips holidays

- **GIVEN** a step submitted before a weekend and a company holiday
- **WHEN** the SLA due time is computed from `sla_hours`
- **THEN** weekends and the company's `holiday_calendar` dates are excluded from the elapsed
  working hours

#### Scenario: Escalation never targets the creator

- **GIVEN** an overdue step whose superior is the document's creator
- **WHEN** the escalation sweep runs
- **THEN** the creator is skipped and the item escalates to the next eligible actor instead

#### Scenario: Active delegation suppresses escalation

- **GIVEN** an overdue step whose approver has an active delegation covering the document
- **WHEN** the escalation sweep runs
- **THEN** the item is left for the delegate and is not escalated
