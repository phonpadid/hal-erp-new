## MODIFIED Requirements

### Requirement: Shift Resolution For An Employee And Date

The system SHALL resolve the shift expected of an employee on a date by taking the `employee_shift` whose range covers that date, and when none exists, the `default_work_shift_id` of the employee's department. When neither yields a shift the resolution SHALL return no shift, which is a valid result and MUST NOT be treated as an error. Resolution SHALL return the shift together with the weekday's effective `start_minute`, `end_minute`, and working flag, so a caller obtains everything needed to judge a day without re-reading configuration. Resolution SHALL consider inactive shifts so that an assignment made before a shift was deactivated still resolves. The system SHALL additionally resolve a contiguous range of dates for one employee in a single operation, returning one result per date, so that a caller computing a period does not issue one resolution per day.

#### Scenario: Personal assignment wins over the department default

- **GIVEN** an employee assigned to the night shift and a department whose default is the office shift
- **WHEN** the shift is resolved for a date inside the assignment's range
- **THEN** the night shift is returned

#### Scenario: Department default applies with no personal assignment

- **GIVEN** an employee with no `employee_shift` row and a department whose `default_work_shift_id` is the office shift
- **WHEN** the shift is resolved for any date
- **THEN** the office shift is returned

#### Scenario: No shift resolves for an unassigned employee

- **GIVEN** an employee with no `employee_shift` row in a department with no `default_work_shift_id`
- **WHEN** the shift is resolved
- **THEN** no shift is returned and no error is raised

#### Scenario: Resolution returns the weekday's effective hours

- **GIVEN** a shift running 08:00–17:00 whose weekday 6 overrides `end_minute` to 12:00
- **WHEN** the shift is resolved for a Saturday
- **THEN** the result reports the day as working with an effective end of 12:00

#### Scenario: A deactivated shift still resolves for an existing assignment

- **GIVEN** an employee assigned to a `work_shift` that is later set `is_active` false
- **WHEN** the shift is resolved for a date inside the assignment's range
- **THEN** the deactivated shift is still returned

#### Scenario: A range resolves in one operation

- **WHEN** a caller resolves a month for one employee
- **THEN** one result is returned per date in the range, each carrying that date's effective hours and working flag

#### Scenario: A range spanning an assignment change reflects both shifts

- **GIVEN** an employee assigned to shift A until the 15th and shift B from the 16th
- **WHEN** the month is resolved as a range
- **THEN** dates up to the 15th report shift A and dates from the 16th report shift B
