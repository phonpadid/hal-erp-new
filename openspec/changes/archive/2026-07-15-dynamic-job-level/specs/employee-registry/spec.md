## MODIFIED Requirements

### Requirement: Employee Registry Management

The system SHALL let an `EMPLOYEE_MANAGE` user list, create, and update `employee` records
scoped to the active company. Each `employee` SHALL carry `emp_code` (unique per company),
`full_name`, `department_id`, and an optional `position`, `job_level`, `hire_date`, and `status`
(`ACTIVE` / `RESIGNED` / `TERMINATED`). When `job_level` is provided it SHALL be the `code` of an
active `job_level` master row in the employee's company; a `job_level` that is empty/absent SHALL
be allowed, but a non-empty value that does not resolve to an active `job_level` row in that
company SHALL be rejected. Employee records are company-scoped and SHALL never be read or written
across companies.

#### Scenario: Create an employee in the active company

- **WHEN** an `EMPLOYEE_MANAGE` user creates an employee with a unique `emp_code` and a department
- **THEN** the employee is stored under the active company with status `ACTIVE`

#### Scenario: Create with a valid job level

- **WHEN** an `EMPLOYEE_MANAGE` user creates an employee whose `job_level` is the code of an
  active `job_level` in the active company
- **THEN** the employee is stored with that `job_level`

#### Scenario: Create with an unknown job level is rejected

- **WHEN** an `EMPLOYEE_MANAGE` user sets `job_level` to a code that has no active `job_level`
  row in the active company
- **THEN** the request is rejected and no record is created

#### Scenario: Duplicate emp_code in the same company is rejected

- **WHEN** an `EMPLOYEE_MANAGE` user creates an employee whose `emp_code` already exists in the
  active company
- **THEN** the request is rejected and no record is created

#### Scenario: Employees are company-scoped

- **WHEN** an `EMPLOYEE_MANAGE` user lists employees
- **THEN** only employees of the active company are returned

### Requirement: Promotion Applies Position, Salary, and Level

The system SHALL provide a promotion application that updates an employee's `position`, `salary`,
and/or `job_level` in the active company within a caller-supplied transaction, so an approved
`UPDATE_EMPLOYEE` document can apply it atomically with approval. Only the provided fields SHALL
change; when `job_level` is provided it SHALL be the `code` of an active `job_level` master row
in the employee's company and SHALL be rejected otherwise; `salary` SHALL be handled as a decimal
string (never a JS number); `emp_code` and company SHALL be immutable.

#### Scenario: Promotion updates the provided fields only

- **WHEN** a promotion supplies a new position and salary but no job level
- **THEN** the employee's position and salary change and the job level is unchanged

#### Scenario: Promotion to a valid new level

- **WHEN** a promotion supplies a `job_level` that is an active `job_level` code in the company
- **THEN** the employee's job level changes to it

#### Scenario: Promotion to an unknown level is rejected

- **WHEN** a promotion supplies a `job_level` with no active `job_level` row in the company
- **THEN** the promotion is rejected and the employee's level is unchanged

#### Scenario: Promotion preserves money precision

- **WHEN** a promotion sets a salary
- **THEN** it is stored as the exact decimal value, not a rounded floating-point number
