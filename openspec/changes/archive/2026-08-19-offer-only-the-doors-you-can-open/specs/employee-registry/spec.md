# employee-registry

## ADDED Requirements

### Requirement: Requester Employee Selection Read

The system SHALL expose a requester-facing employee read, authorized by the document-create
permission `DOC_CREATE` (not `EMPLOYEE_MANAGE`), mirroring the budget picker read
`GET /budgets/selectable`. It SHALL return the active company's active employees, each with its
`id`, `emp_code` and `full_name`, and nothing else — no salary, no job level, no employment history.
The read SHALL be company-scoped and SHALL NOT require any HR administration permission.

A document type configured `requires_employee` cannot be submitted without naming the person it acts
on, so the person raising it must be able to list them. `EMPLOYEE_MANAGE` is full HR administration —
onboarding, salary, termination — and granting it so that a form can show a name gives away far more
than the form needs.

The existing administration reads SHALL keep `EMPLOYEE_MANAGE`. This is an additional, narrower read.

#### Scenario: A requester lists selectable employees without EMPLOYEE_MANAGE

- **WHEN** a user holding `DOC_CREATE` but not `EMPLOYEE_MANAGE` requests the selectable employee read
- **THEN** the active company's active employees are returned and no authorization error occurs

#### Scenario: The administration read is unchanged

- **WHEN** a user without `EMPLOYEE_MANAGE` requests the full employee list
- **THEN** the request is still refused

#### Scenario: The selection read carries no employment detail

- **WHEN** a requester lists selectable employees
- **THEN** each entry carries only an identifier, a code and a name
