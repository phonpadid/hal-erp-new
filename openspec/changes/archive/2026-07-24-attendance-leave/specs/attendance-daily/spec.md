## MODIFIED Requirements

### Requirement: Day Status Resolution

The system SHALL resolve each day's `status` in this order: `NO_SHIFT` when no shift resolves for the employee on that date; `HOLIDAY` when the date is in the company `holiday_calendar`; `DAY_OFF` when the shift does not work that weekday; `EXEMPT` when the employee's `attendance_required` is false; `LEAVE` when an approved leave request covers the date for a full day; `ABSENT` when the day is a working day with no punches in the window; `INCOMPLETE` when punches exist but no usable first-and-last pair can be formed; otherwise `PRESENT`. A leave covering only half the date SHALL NOT set the status: it SHALL halve the day's `expected_minutes` and shift the expected start or end to the half actually worked, so the remaining half is judged normally. The status SHALL describe the day, while lateness, early departure, and overtime are carried as quantities rather than as further statuses.

#### Scenario: A day with no resolvable shift

- **GIVEN** an employee with no assignment and no department default
- **WHEN** a day is computed
- **THEN** the status is `NO_SHIFT` and no error is raised

#### Scenario: A holiday outranks a day off

- **GIVEN** a date that is both a company holiday and a weekday the shift does not work
- **WHEN** the day is computed
- **THEN** the status is `HOLIDAY`, the more specific reason

#### Scenario: Approved leave outranks absence

- **GIVEN** a working day with no punches, covered in full by an approved leave request
- **WHEN** the day is computed
- **THEN** the status is `LEAVE`, not `ABSENT`, because the leave is why nobody came

#### Scenario: Leave on a day nobody works is not leave

- **GIVEN** an approved leave whose range spans a company holiday
- **WHEN** the holiday is computed
- **THEN** the status remains `HOLIDAY` and no leave is charged for it

#### Scenario: Unapproved leave does not excuse a day

- **GIVEN** a submitted but unapproved leave request covering a working day with no punches
- **WHEN** the day is computed
- **THEN** the status is `ABSENT`, because nothing has been decided yet

#### Scenario: An afternoon of leave still expects the morning

- **GIVEN** an 08:00-17:00 shift and approved `PM` leave on a date
- **WHEN** the employee arrives at 08:40 and leaves at 12:00
- **THEN** the status is `PRESENT` with `expected_minutes` halved, and the late arrival is still recorded

#### Scenario: A morning of leave does not make an afternoon arrival late

- **GIVEN** an 08:00-17:00 shift with a 12:00-13:00 break and approved `AM` leave
- **WHEN** the employee arrives at 13:00
- **THEN** no lateness is recorded, because the morning was not expected

#### Scenario: An absent working day

- **GIVEN** a working day with no punches and no approved leave
- **WHEN** the day is computed
- **THEN** the status is `ABSENT`

#### Scenario: A single punch cannot form a day

- **GIVEN** a working day with one check-in and no check-out
- **WHEN** the day is computed
- **THEN** the status is `INCOMPLETE` and `worked_minutes` is 0

#### Scenario: An exempt employee is not reported absent

- **GIVEN** an employee whose `attendance_required` is false and who did not punch
- **WHEN** the day is computed
- **THEN** the status is `EXEMPT`, not `ABSENT`

#### Scenario: Lateness does not change the status

- **GIVEN** a working day on which an employee arrived late and left early
- **WHEN** the day is computed
- **THEN** the status is `PRESENT` while `late_minutes` and `early_leave_minutes` carry the detail

#### Scenario: Working a holiday keeps the holiday status

- **GIVEN** a company holiday on which an employee worked
- **WHEN** the day is computed
- **THEN** the status remains `HOLIDAY` and `holiday_work_minutes` is non-zero
