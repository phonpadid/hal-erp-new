## ADDED Requirements

### Requirement: Company Management

The web app SHALL let a `COMPANY_VIEW` user list companies and a `COMPANY_MANAGE` user create and
edit them (names, tax id, branch, base currency, active state), validated client-side against the
shared schema.

#### Scenario: Create a company

- **WHEN** a `COMPANY_MANAGE` user submits a valid new company
- **THEN** it appears in the company list

#### Scenario: Edit a company

- **WHEN** the user edits a company's details
- **THEN** the change is saved and reflected in the list

### Requirement: Department Management

The web app SHALL let a `DEPARTMENT_MANAGE` user manage the active company's departments — list,
create (code, name, optional parent and cost center), edit, and deactivate; viewing requires
`DEPARTMENT_VIEW`. Departments shown are scoped to the active company.

#### Scenario: Create a department

- **WHEN** the user creates a department in the active company
- **THEN** it appears in that company's department list

#### Scenario: Deactivate a department

- **WHEN** the user deactivates a department
- **THEN** it shows as inactive

### Requirement: Fiscal Year and Period Control

The web app SHALL let a `FISCAL_YEAR_MANAGE` user list and create fiscal years (year + start/end
dates), edit their dates, and close a fiscal year. Closing a period reflects its status, which the
server uses to block document submission outside an open period.

#### Scenario: Create a fiscal year

- **WHEN** the user creates a fiscal year for the active company
- **THEN** it appears in the list with an open status

#### Scenario: Close a fiscal year

- **WHEN** the user closes a fiscal year
- **THEN** its status shows as closed

### Requirement: Holiday Calendar Management

The web app SHALL let a `HOLIDAY_MANAGE` user list, add, and delete the active company's holidays
(date + name).

#### Scenario: Add a holiday

- **WHEN** the user adds a holiday date with a name
- **THEN** it appears in the active company's holiday list

### Requirement: Permission-Gated Organization Admin

The organization navigation, tabs, and actions SHALL be shown by permission code — viewing by the
relevant `*_VIEW`/`*_MANAGE` code and each mutation by its `*_MANAGE` code (UX only; the server
still enforces). The area is scoped to the active company where applicable.

#### Scenario: Organization hidden without permission

- **WHEN** a user without any organization permission is signed in
- **THEN** the Organization navigation entry is not shown
