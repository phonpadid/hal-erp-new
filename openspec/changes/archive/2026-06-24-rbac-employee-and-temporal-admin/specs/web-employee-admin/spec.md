## ADDED Requirements

### Requirement: Employee Registry Admin Screen

The web app SHALL provide an employee-administration area for the active company where an
`EMPLOYEE_MANAGE` user can list employees, create an employee, and edit an employee
(`emp_code`, `full_name`, department, `position`, `job_level`, `hire_date`, `status`). The list
and form are scoped to the active company; switching the active company SHALL change the
employees shown. Validation SHALL use a Zod schema mirroring the backend DTO.

#### Scenario: Create an employee from the UI

- **WHEN** an `EMPLOYEE_MANAGE` user submits the new-employee form with a unique `emp_code` and a
  department
- **THEN** the employee appears in the active company's employee list

#### Scenario: Employees are scoped to the active company

- **WHEN** the admin switches the active company
- **THEN** the employee list reloads to show only that company's employees

### Requirement: Link Employee to a Login Account

The screen SHALL let an `EMPLOYEE_MANAGE` user link an employee to an existing `app_user`
account and unlink it, and SHALL indicate for each employee whether a login account is linked.

#### Scenario: Show linked-account status

- **WHEN** the admin views the employee list
- **THEN** each row indicates whether the employee has a linked login account

#### Scenario: Unlink a login account

- **WHEN** the admin unlinks an employee from its login account
- **THEN** the employee is shown as having no linked account, and the user's role assignments are
  unaffected

### Requirement: Resignation From the UI

The screen SHALL let an `EMPLOYEE_MANAGE` user mark an employee resigned, after a confirmation,
which revokes only the active company's access for the linked user.

#### Scenario: Mark resigned with confirmation

- **WHEN** the admin confirms resignation for an employee
- **THEN** the employee status is shown as `RESIGNED` and the user's access in the active company
  is removed

### Requirement: Salary Display is Permission-Gated

The screen SHALL show the salary field only to users holding `EMP_SALARY_VIEW`; otherwise the
field SHALL be hidden in both the list and the form (UX only; the server stays authoritative).

#### Scenario: Salary hidden without permission

- **WHEN** an `EMPLOYEE_MANAGE` user without `EMP_SALARY_VIEW` opens the employee screen
- **THEN** no salary value is displayed

### Requirement: Permission-Gated Employee Administration

The employee-admin navigation, lists, and actions SHALL be shown only to users holding
`EMPLOYEE_MANAGE` (UX only; the server still enforces).

#### Scenario: Employee admin hidden without permission

- **WHEN** a user without `EMPLOYEE_MANAGE` is signed in
- **THEN** the employee-admin navigation entry is not shown
