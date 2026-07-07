## ADDED Requirements

### Requirement: HR Post-Actions Apply Personnel Changes

On full approval the system SHALL apply the HR post-actions to the document's `related_employee`,
atomically with the terminal transition and inside the post-action's bounded retry. An
`UPDATE_EMPLOYEE` post-action SHALL read the document's field values for the new `position`,
`salary`, and `job_level` (well-known field names) and apply the present ones to the employee,
recording the document's `effective_date` field. A `TERMINATE_EMPLOYEE` post-action SHALL set the
employee `status` to `RESIGNED` and expire that company's `user_company_role` rows for the linked
user as of the `effective_date`. When the document has no `related_employee` the post-action SHALL be
a logged no-op. If the apply fails after retries the APPROVED/COMPLETED transition SHALL roll back so
the employee is never half-changed.

#### Scenario: Promotion updates position and salary on approval

- **GIVEN** an approved `UPDATE_EMPLOYEE` document for an employee, with field values for a new
  position and salary
- **WHEN** the post-action runs
- **THEN** the employee's `position` and `salary` are updated and the effective date is recorded

#### Scenario: Resignation closes the employee and revokes company access

- **GIVEN** an approved `TERMINATE_EMPLOYEE` document for an employee linked to a user
- **WHEN** the post-action runs
- **THEN** the employee `status` becomes `RESIGNED` and that company's `user_company_role` rows are
  expired as of the effective date, while the shared `app_user` and other companies are untouched

#### Scenario: Missing related employee is a no-op

- **WHEN** an HR post-action runs on a document with no `related_employee`
- **THEN** it does nothing (logged) and the approval still completes

#### Scenario: A failing HR apply rolls back

- **WHEN** the HR apply throws after retries (e.g. an unparseable salary)
- **THEN** the APPROVED/COMPLETED transition rolls back and the employee is unchanged
