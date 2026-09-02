## MODIFIED Requirements

### Requirement: Daily Projection Reads

The system SHALL provide a paged, company-scoped read of `attendance_day`, guarded by `ATTEND_DAY_READ`, filterable by employee, shift-date range, and status, ordered by shift date. Every returned row SHALL include `computed_at` so a caller can judge how current the projection is. The system SHALL additionally provide a self-service read, guarded by `ATTEND_DAY_SELF`, returning only the calling user's own days. `ATTEND_DAY_SELF` SHALL be a distinct code from `ATTEND_DAY_READ`: seeing your own attendance MUST NOT require the power to see everybody's, which is the same separation `ATTEND_PUNCH_SELF` and `ATTEND_PUNCH_READ` already draw over the punch ledger. The self-service read SHALL resolve the employee from the caller's account within the active company and SHALL NOT accept an employee identifier.

#### Scenario: Reading one employee's month

- **WHEN** an `ATTEND_DAY_READ` user lists days for an employee over a date range
- **THEN** only that employee's rows in that range are returned, ordered by shift date

#### Scenario: Reads are company-scoped

- **WHEN** an `ATTEND_DAY_READ` user lists days
- **THEN** only the active company's rows are returned

#### Scenario: Staleness is visible

- **WHEN** any row is returned
- **THEN** it carries the `computed_at` at which its numbers were produced

#### Scenario: Filtering a day's absentees

- **WHEN** an `ATTEND_DAY_READ` user lists a date filtered to status `ABSENT`
- **THEN** only rows with that status are returned

#### Scenario: Reading your own days needs only the self code

- **GIVEN** a user holding `ATTEND_DAY_SELF` and not `ATTEND_DAY_READ`
- **WHEN** they call the self-service read
- **THEN** their own days are returned

#### Scenario: The self code does not open the general read

- **GIVEN** a user holding `ATTEND_DAY_SELF` and not `ATTEND_DAY_READ`
- **WHEN** they call the general list
- **THEN** it is forbidden

#### Scenario: The self-service read cannot be pointed at another employee

- **WHEN** the self-service read is called with another employee's identifier in the query
- **THEN** it is ignored and only the caller's own days are returned
