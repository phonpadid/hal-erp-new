# Employee Registry Specification

## Purpose
A company-scoped registry of employees that exists independently of login accounts.
An employee record may optionally be linked to one `app_user`. Resignation revokes
only the active company's role assignments, never the shared account, and the salary
field is gated behind a dedicated permission.
## Requirements
### Requirement: Employee Registry Management

The system SHALL let an `EMPLOYEE_MANAGE` user list, create, and update `employee` records
scoped to the active company. Each `employee` SHALL carry `emp_code` (unique per company),
`full_name`, `department_id`, and an optional `position`, `job_level`, `hire_date`, and `status`
(`ACTIVE` / `RESIGNED` / `TERMINATED`). Employee records are company-scoped and SHALL never be
read or written across companies.

#### Scenario: Create an employee in the active company

- **WHEN** an `EMPLOYEE_MANAGE` user creates an employee with a unique `emp_code` and a department
- **THEN** the employee is stored under the active company with status `ACTIVE`

#### Scenario: Duplicate emp_code in the same company is rejected

- **WHEN** an `EMPLOYEE_MANAGE` user creates an employee whose `emp_code` already exists in the
  active company
- **THEN** the request is rejected and no record is created

#### Scenario: Employees are company-scoped

- **WHEN** an `EMPLOYEE_MANAGE` user lists employees
- **THEN** only employees of the active company are returned

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
change; `salary` SHALL be handled as a decimal string (never a JS number); `emp_code` and company
SHALL be immutable.

#### Scenario: Promotion updates the provided fields only

- **WHEN** a promotion supplies a new position and salary but no job level
- **THEN** the employee's position and salary change and the job level is unchanged

#### Scenario: Promotion preserves money precision

- **WHEN** a promotion sets a salary
- **THEN** it is stored as the exact decimal value, not a rounded floating-point number

