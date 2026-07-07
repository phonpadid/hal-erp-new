# web-org-admin

## Purpose
The Vue organization-administration area for the active company: the screens where a
permitted user manages companies, the active company's departments, fiscal years (with
period open/close), and the holiday calendar. Company records are global, while
departments, fiscal years, and holidays are scoped to the active company, so switching
the active company changes what is shown and managed. Navigation, tabs, and actions are
gated per multi-company permission code — viewing by the relevant `*_VIEW`/`*_MANAGE`
code and each mutation by its `*_MANAGE` code — as a UX-only guard; the server remains
authoritative and enforces company scope.
## Requirements
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

The department list SHALL be presented as a hierarchy that reflects each department's
`department.parent_dept_id`, so the ฝ่าย → แผนก → หน่วยงาน structure is visible; a department with
no parent is shown as a root and its children nest beneath it. When choosing a parent for a
department, the user SHALL select from that hierarchy, and the department being edited together with
its descendants SHALL be excluded from the selectable parents (a UX guard mirroring the server's
cycle rejection; the server remains authoritative).

#### Scenario: Create a department

- **WHEN** the user creates a department in the active company
- **THEN** it appears in that company's department list

#### Scenario: Deactivate a department

- **WHEN** the user deactivates a department
- **THEN** it shows as inactive

#### Scenario: Departments shown as a hierarchy

- **WHEN** the active company has departments linked by `parent_dept_id`
- **THEN** each department is displayed nested under its parent, and departments without a parent
  are displayed as roots

#### Scenario: Parent selection excludes self and descendants

- **WHEN** the user edits a department and opens the parent selector
- **THEN** that department and all of its descendants are not offered as selectable parents

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

The organization admin SHALL be presented as four separate, sidebar-navigated pages — Companies,
Departments, Fiscal years, and Holidays — grouped under a dedicated **Organization** sidebar
section, rather than as tabs within a single screen. Each page SHALL have its own route and SHALL be
directly linkable. The Organization sidebar group, its page entries, and each action SHALL be shown
by permission code — viewing by the relevant `*_VIEW` code and each mutation by its `*_MANAGE` code
(UX only; the server still enforces). The area is scoped to the active company where applicable. The
legacy `/org-admin` path SHALL redirect to the Companies page so existing links keep working.

#### Scenario: Organization hidden without permission

- **WHEN** a user without any organization permission is signed in
- **THEN** the Organization sidebar group and its pages are not shown

#### Scenario: Each area is its own page

- **WHEN** a permitted user opens the Organization group in the sidebar
- **THEN** Companies, Departments, Fiscal years, and Holidays are listed as separate entries, each
  navigating to its own page rather than switching a tab

#### Scenario: Legacy path redirects

- **WHEN** a user navigates to the legacy `/org-admin` path
- **THEN** they are redirected to the Companies page

