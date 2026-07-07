## MODIFIED Requirements

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

## ADDED Requirements

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
