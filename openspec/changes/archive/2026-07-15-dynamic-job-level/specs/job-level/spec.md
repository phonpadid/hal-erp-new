## ADDED Requirements

### Requirement: Company-Scoped Job-Level Master Data

The system SHALL provide a company-scoped `job_level` master-data registry. Each `job_level`
SHALL carry `company_id`, `code`, `name`, `rank` (a non-null integer expressing seniority order,
higher meaning more senior), and `is_active` (default true). `code` SHALL be unique per company
(`(company_id, code)`). `job_level` rows SHALL never be read or written across companies
(invariant 1). Defining levels SHALL be authorized by a `JOB_LEVEL_MANAGE` permission code and
reading by `JOB_LEVEL_VIEW`, never a role name (invariant 6).

#### Scenario: Create a job level in the active company

- **WHEN** a `JOB_LEVEL_MANAGE` user creates a `job_level` with a `code`, `name`, and `rank`
- **THEN** the row is stored under the active company with `is_active` true

#### Scenario: Duplicate code in the same company is rejected

- **WHEN** a `JOB_LEVEL_MANAGE` user creates a `job_level` whose `code` already exists in the
  active company
- **THEN** the request is rejected and no row is created

#### Scenario: The same code may exist in different companies

- **GIVEN** company A has a `job_level` with `code` "MANAGER"
- **WHEN** a `JOB_LEVEL_MANAGE` user in company B creates a `job_level` with `code` "MANAGER"
- **THEN** the row is created in company B and is independent of company A's

#### Scenario: Job levels are company-scoped

- **WHEN** a `JOB_LEVEL_VIEW` user lists job levels
- **THEN** only the active company's `job_level` rows are returned

#### Scenario: Managing job levels is permission-gated

- **WHEN** a request without `JOB_LEVEL_MANAGE` tries to create or update a `job_level`
- **THEN** the request is forbidden and nothing changes

### Requirement: Job-Level Deactivation over Deletion

The system SHALL let a `JOB_LEVEL_MANAGE` user deactivate a `job_level` by setting `is_active`
false rather than hard-deleting it. A deactivated `job_level` SHALL be excluded from the option
sets offered when assigning a level to an employee or authoring a workflow-step condition, but
SHALL still resolve for existing `employee.job_level` and `workflow_step.condition_json`
references so historical routing stays stable. A `job_level` that is still referenced by any
`employee` or step condition SHALL NOT be hard-deleted.

#### Scenario: Deactivated level leaves existing references intact

- **GIVEN** an `employee` whose `job_level` is "MANAGER" and a workflow step engaging for
  "MANAGER"
- **WHEN** a `JOB_LEVEL_MANAGE` user deactivates the "MANAGER" `job_level`
- **THEN** the level no longer appears in the assignment/condition option sets, but the existing
  employee and step still resolve "MANAGER" and routing is unchanged

#### Scenario: In-use level cannot be hard-deleted

- **WHEN** a `JOB_LEVEL_MANAGE` user attempts to hard-delete a `job_level` still referenced by an
  employee or a step condition
- **THEN** the deletion is rejected and the level remains (deactivation is offered instead)

### Requirement: Referenced Job-Level Codes Must Resolve

The system SHALL require that a `job_level` code referenced from another record — an
`employee.job_level` value or a `workflow_step.condition_json` `jobLevels` entry — resolves to a
`job_level` row in the same company. The system SHALL reject writes that would set
`employee.job_level` or a step's `jobLevels` to a code with no matching `job_level` row in that
company.

#### Scenario: Unknown code is rejected on assignment

- **WHEN** a write sets `employee.job_level` to a code that has no `job_level` row in the
  employee's company
- **THEN** the write is rejected and the employee's level is unchanged
