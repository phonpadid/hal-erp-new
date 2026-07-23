# Employee Registry Specification

## Purpose
A company-scoped registry of employees that exists independently of login accounts.
An employee record may optionally be linked to one `app_user`. Resignation revokes
only the active company's role assignments, never the shared account, and the salary
field is gated behind a dedicated permission.
## Requirements
### Requirement: Employee Registry Management

The system SHALL let an `EMPLOYEE_MANAGE` user list, create, and update `employee` records scoped to the active company. Each `employee` SHALL carry `emp_code` (unique per company), `full_name`, `department_id`, `attendance_required` (default true), `employment_type` (`MONTHLY` / `DAILY` / `HOURLY`, default `MONTHLY`), and an optional `position`, `job_level`, `hire_date`, and `status` (`ACTIVE` / `RESIGNED` / `TERMINATED`). When `job_level` is provided it SHALL be the `code` of an active `job_level` master row in the employee's company; a `job_level` that is empty/absent SHALL be allowed, but a non-empty value that does not resolve to an active `job_level` row in that company SHALL be rejected. `attendance_required` SHALL mark whether the employee is expected to record attendance: an employee with `attendance_required` false SHALL NOT be reported as absent, while any attendance they do record SHALL still be stored. `employment_type` SHALL record the pay basis, because work on a company holiday is compensated at a different rate for monthly-paid than for daily-paid staff and the distinction MUST be recorded at the source rather than inferred later. Employee records are company-scoped and SHALL never be read or written across companies.

#### Scenario: Create an employee in the active company

- **WHEN** an `EMPLOYEE_MANAGE` user creates an employee with a unique `emp_code` and a department
- **THEN** the employee is stored under the active company with status `ACTIVE`
- **AND** `attendance_required` is true and `employment_type` is `MONTHLY`

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

#### Scenario: Exempt an employee from attendance

- **WHEN** an `EMPLOYEE_MANAGE` user sets `attendance_required` false on an executive
- **THEN** the employee is excluded from absence reporting
- **AND** any attendance recorded for them is still stored

#### Scenario: Record a daily-paid employee

- **WHEN** an `EMPLOYEE_MANAGE` user creates an employee with `employment_type` `DAILY`
- **THEN** the employee is stored with that pay basis

#### Scenario: An unknown employment type is rejected

- **WHEN** an `EMPLOYEE_MANAGE` user sets `employment_type` to a value outside `MONTHLY` / `DAILY` / `HOURLY`
- **THEN** the request is rejected and the employee is unchanged

#### Scenario: Existing employees carry the new fields after migration

- GIVEN employees created before these fields existed
- WHEN the schema migration runs
- THEN every existing employee has `attendance_required` true and `employment_type` `MONTHLY`

### Requirement: Employee Account is Separate and Optional

An `employee` record SHALL exist independently of an `app_user` login account. The system SHALL
let an `EMPLOYEE_MANAGE` user link an employee to exactly one `app_user`, and unlink it.
Linking or unlinking SHALL set or clear only `employee.user_id` and SHALL NOT create, delete, or
alter any `user_company_role` assignment or the `app_user` account.

#### Scenario: Employee exists without a login account

- **WHEN** an employee is created without a linked user
- **THEN** the employee is stored with no `user_id` and cannot sign in, while remaining a valid
  registry record

#### Scenario: Unlinking does not change access

- **GIVEN** an employee linked to a user who holds role assignments in the active company
- **WHEN** the employee is unlinked from the user
- **THEN** only `employee.user_id` is cleared
- **AND** the user's `user_company_role` assignments are unchanged

### Requirement: Resignation Affects One Company Only

The system SHALL provide a resignation action that, in a single transaction, sets the employee's
`status` to `RESIGNED` and expires that company's `user_company_role` rows for the linked user (by
setting `valid_to`). It SHALL NOT modify the `app_user` account or any assignment in another company.
The action SHALL be applyable within a caller-supplied transaction and company scope so an approved
`TERMINATE_EMPLOYEE` document can apply it atomically with approval, and SHALL set `valid_to` to a
supplied effective date (defaulting to immediate when none is given).

#### Scenario: Resignation revokes only the active company's access

- **GIVEN** an employee in company A linked to a user who also holds assignments in company B
- **WHEN** the employee is marked resigned in company A
- **THEN** the employee status becomes `RESIGNED` and the user's company A assignments are expired
- **AND** the user can still sign in and access company B

#### Scenario: Resignation is atomic

- **WHEN** the resignation action runs
- **THEN** the status change and the assignment expiry both commit, or neither does

#### Scenario: Resignation honours an effective date

- **GIVEN** an approved resignation with an effective date in the future
- **WHEN** it is applied
- **THEN** the active company's `user_company_role` rows are expired as of that effective date

### Requirement: Salary Field is Permission-Gated

The `employee.salary` field SHALL be returned only to callers holding `EMP_SALARY_VIEW`. For all
other callers the field SHALL be omitted or masked in every employee read.

#### Scenario: Salary hidden without permission

- **WHEN** an `EMPLOYEE_MANAGE` user without `EMP_SALARY_VIEW` reads an employee
- **THEN** the response does not expose the salary value

#### Scenario: Salary visible with permission

- **WHEN** a user holding `EMP_SALARY_VIEW` reads an employee
- **THEN** the salary value is included

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

