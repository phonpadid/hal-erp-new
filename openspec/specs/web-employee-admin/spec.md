# web-employee-admin

## Purpose
The Vue employee-administration area for the active company, where an `EMPLOYEE_MANAGE`
user lists, creates, and edits employees, links or unlinks login accounts, and marks
employees resigned. The list and forms are company-scoped, the salary field is gated by
`EMP_SALARY_VIEW`, and the whole area is gated by `EMPLOYEE_MANAGE` as a UX-only guard;
the server remains authoritative.

## Requirements

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

### Requirement: Link Employee to a Login Account

The screen SHALL let an `EMPLOYEE_MANAGE` user link an employee to an existing `app_user`
account and unlink it, and SHALL indicate for each employee whether a login account is linked.
When linking to an existing account, the screen SHALL present a **searchable picker of unlinked
accounts** (showing each account's `username` and `email`) and submit the chosen account's id — the
admin SHALL NOT be required to type or paste an `app_user` id. The screen SHALL also let an
`EMPLOYEE_MANAGE` user create a new login account and link it to an employee in one step, by
entering only a `username` and `email` — no password is entered in the UI (the server sets the
initial password from `USER_PASSWORD`). The create-and-link action SHALL be offered only for an
employee that has no linked account. For an employee with no linked account, the screen SHALL also
offer an **"Onboard" entry** that opens the stepped onboarding page (create account **and** grant
first company access in one flow); this entry SHALL be shown only to an admin holding **both**
`EMPLOYEE_MANAGE` and `RBAC_MANAGE`.

#### Scenario: Show linked-account status

- **WHEN** the admin views the employee list
- **THEN** each row indicates whether the employee has a linked login account

#### Scenario: Create a new account and link it in one step

- **WHEN** the admin opens the link dialog for an employee with no account, chooses "create new
  account", enters a valid `username` and `email`, and confirms
- **THEN** a new login account is created and linked to the employee, the row shows the employee as
  having a linked account, and the admin is never asked for a password

#### Scenario: Link an existing account from the picker

- **WHEN** the admin chooses to link an existing account, searches the picker by `username` or
  `email`, and selects an unlinked account
- **THEN** the employee is linked to that account and the row shows the employee as having a linked
  account

#### Scenario: Picker excludes already-linked accounts

- **WHEN** the admin opens the existing-account picker
- **THEN** only accounts not already linked to an employee are offered for selection

#### Scenario: Onboard entry appears only with both permissions

- **WHEN** an admin holding both `EMPLOYEE_MANAGE` and `RBAC_MANAGE` views an employee with no account
- **THEN** an "Onboard" entry is offered that opens the onboarding page; an admin lacking either
  permission does not see it

#### Scenario: Unlink a login account

- **WHEN** the admin unlinks an employee from its login account
- **THEN** the employee is shown as having no linked account, and the user's role assignments are
  unaffected

### Requirement: Verify An Account From The Employee Table

For an employee that has a linked login account, the employee-admin table SHALL show a verification control
(a toggle switch) indicating whether the account's email is verified. An `EMPLOYEE_MANAGE` admin SHALL be
able to turn it on to mark the account verified (no email involved) — the escape hatch when the verification
mail does not arrive. The control SHALL be **verify-only**: an already-verified account shows it on and
disabled, and it cannot be used to un-verify. Employees with no linked account SHALL NOT show the control.

#### Scenario: Toggle shows verification state

- **WHEN** the admin views the employee list
- **THEN** each employee that has a linked account shows a verification toggle reflecting whether the
  account's email is verified

#### Scenario: Admin verifies from the table

- **WHEN** the admin turns the verification toggle on for an unverified account
- **THEN** the account is marked verified, the toggle stays on, and the user can then log in

#### Scenario: Verified toggle is one-way

- **WHEN** an account is already verified
- **THEN** its toggle is shown on and disabled, so it cannot be turned back off from the table

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
