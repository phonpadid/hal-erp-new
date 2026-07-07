## MODIFIED Requirements

### Requirement: Conditional Workflow Selection

The system SHALL bind a document to the workflow mapped to its company, department, and
document type, and SHALL include a step in routing only when the step's conditions match the
document. Step inclusion SHALL honour the step's `amount_min`/`amount_max` band against the
document's `base_total_amount`, AND a step's `workflow_step.condition_json` job-level
restriction (e.g. `{ "jobLevels": ["MANAGER"] }`) against the requester's `employee.job_level`.
A step with no job-level restriction SHALL apply to every requester. When a step restricts
job levels and the requester's `job_level` is among them, the step SHALL be included; when the
requester's `job_level` is present but not among them, that step SHALL be skipped.

A workflow is *level-gated* when at least one of its steps carries a non-empty `jobLevels`
restriction in `workflow_step.condition_json`. When a document is submitted into a level-gated
workflow and the requester has no `employee.job_level` (the requester has no linked `employee`,
or the linked `employee.job_level` is null or empty), the system SHALL reject the submit with a
clear error naming the missing job level, leave the document `DRAFT`, create no budget or quota
holds, and start no routing. The requester's missing `job_level` SHALL NOT silently skip
level-gated steps. When the bound workflow is not level-gated, a requester without a `job_level`
SHALL submit normally.

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

#### Scenario: Missing job level blocks submit into a level-gated workflow

- **GIVEN** a bound workflow with at least one step restricting `jobLevels`
- **AND** a requester whose `employee.job_level` is null or empty (or who has no linked `employee`)
- **WHEN** the document is submitted
- **THEN** the submit is rejected with an error naming the missing job level, the document remains
  `DRAFT`, and no budget/quota holds or routing are created

#### Scenario: Missing job level does not block a non-level-gated workflow

- **GIVEN** a bound workflow whose steps carry no `jobLevels` restriction
- **AND** a requester whose `employee.job_level` is null or empty
- **WHEN** the document is submitted
- **THEN** the submit proceeds normally and routing starts over the applicable steps
