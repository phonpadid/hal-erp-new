## MODIFIED Requirements

### Requirement: Employee Registry Admin Screen

The web app SHALL provide an employee-administration area for the active company where an
`EMPLOYEE_MANAGE` user can list employees, create an employee, and edit an employee
(`emp_code`, `full_name`, department, `position`, `job_level`, `hire_date`, `status`). Creating
an employee SHALL happen on a **dedicated create page** reached from the admin screen (a
`EMPLOYEE_MANAGE`-guarded route), not in an inline dialog; editing MAY continue to use an inline
dialog. The `job_level` field on both the create and edit forms SHALL be a Select whose options
are the active company's active `job_level` master rows (presented by `name`/`code`, submitting
the `code`); it SHALL allow an empty selection and SHALL NOT be a free-text input. The list and
both forms are scoped to the active company; switching the active company SHALL change the
employees shown and reload the available job levels. Validation SHALL use the shared Zod schema
mirroring the backend DTO. The create page SHALL show a decorative illustration for visual
polish, styled with theme tokens so it renders correctly in both light and dark mode.

#### Scenario: Open the create page from the admin screen

- **WHEN** an `EMPLOYEE_MANAGE` user activates the "New Employee" action on the employee-admin
  screen
- **THEN** the app navigates to the dedicated create-employee page for the active company (no
  create dialog is shown)

#### Scenario: Job level is chosen from the master list

- **WHEN** an `EMPLOYEE_MANAGE` user opens the job-level field on the create or edit form
- **THEN** the options are the active company's active `job_level` rows, and the field is a
  Select rather than a free-text input

#### Scenario: Create an employee from the page

- **WHEN** an `EMPLOYEE_MANAGE` user submits the create-employee page with a unique `emp_code`
  and a `department_id`
- **THEN** the employee is created in the active company and the app returns to the employee
  list where the new employee appears, with success feedback

#### Scenario: Cancel returns to the list without creating

- **WHEN** the user cancels or navigates back from the create page
- **THEN** no employee is created and the app returns to the employee-admin list

#### Scenario: Create page is permission-gated

- **WHEN** a user without `EMPLOYEE_MANAGE` attempts to reach the create-employee route
- **THEN** access is denied by the route guard (mirroring the server's permission-code
  enforcement)

#### Scenario: Employees are scoped to the active company

- **WHEN** the admin switches the active company
- **THEN** the employee list reloads to show only that company's employees
