## MODIFIED Requirements

### Requirement: Employee Registry Management

The system SHALL let an `EMPLOYEE_MANAGE` user list, create, and update `employee` records scoped to the active company. Each `employee` SHALL carry `emp_code` (unique per company), `full_name`, `department_id`, `attendance_required` (default true), `employment_type` (`MONTHLY` / `DAILY` / `HOURLY`, default `MONTHLY`), an optional `attendance_affects_pay`, and an optional `position`, `job_level`, `hire_date`, and `status` (`ACTIVE` / `RESIGNED` / `TERMINATED`). When `job_level` is provided it SHALL be the `code` of an active `job_level` master row in the employee's company; a `job_level` that is empty/absent SHALL be allowed, but a non-empty value that does not resolve to an active `job_level` row in that company SHALL be rejected. `attendance_required` SHALL mark whether the employee is expected to record attendance: an employee with `attendance_required` false SHALL NOT be reported as absent, while any attendance they do record SHALL still be stored. `employment_type` SHALL record the pay basis, because work on a company holiday is compensated at a different rate for monthly-paid than for daily-paid staff and the distinction MUST be recorded at the source rather than inferred later. `attendance_affects_pay` SHALL be three-valued: true, false, or unset meaning inherit from the employee's department, whose own setting SHALL default to true. It SHALL mark whether attendance drives this person's pay and SHALL NOT change any attendance computation — an employee whose attendance does not affect pay is still measured for lateness and absence, and only the marking on a closed period's line differs. Employee records are company-scoped and SHALL never be read or written across companies.

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

#### Scenario: Attendance-affects-pay is unset by default

- **WHEN** an `EMPLOYEE_MANAGE` user creates an employee without stating `attendance_affects_pay`
- **THEN** it is unset, and the employee inherits their department's setting

#### Scenario: A person overrides their department

- **GIVEN** a department whose attendance affects pay
- **WHEN** one employee is set to `attendance_affects_pay` false
- **THEN** that employee resolves to false while their colleagues resolve to true

#### Scenario: The setting changes no attendance figure

- **GIVEN** two employees with identical attendance and different `attendance_affects_pay`
- **WHEN** their days are computed
- **THEN** their late minutes, absences and worked minutes are identical
