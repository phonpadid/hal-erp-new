## MODIFIED Requirements

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
