# Attendance-Shift Specification

## Purpose
The hours a company expects of its employees: company-scoped `work_shift` definitions with the
tolerances that turn clock times into judgements, the weekday pattern each shift works (including
per-day hours, so a shorter Saturday is expressible), dated per-employee assignment with a
department-level default, and `work_location` geofence definitions. Times are stored as minutes
from local midnight so a night shift needs no "crosses midnight" flag, and resolving what was
expected of a person on a date is a single total lookup that may legitimately return nothing.
This capability holds no time records — it is what a later attendance day is judged against.

## Requirements
### Requirement: Company-Scoped Work-Shift Master

The system SHALL provide a company-scoped `work_shift` master defining the hours an employee is expected to work. Each `work_shift` SHALL carry `company_id`, `code`, `name`, `start_minute` and `end_minute` (minutes counted from local midnight), `standard_minutes` (the paid working minutes of a full day, excluding the break), `grace_minutes`, `half_day_threshold_minutes`, `ot_min_minutes`, `ot_round_minutes`, and `is_active` (default true). `code` SHALL be unique per company (`(company_id, code)`). `end_minute` MAY exceed 1440 to express a shift ending on the following calendar day, and the system SHALL derive "crosses midnight" from `end_minute` > 1440 rather than storing it. `end_minute` SHALL be greater than `start_minute`. `work_shift` rows SHALL never be read or written across companies (invariant 1). Managing shifts SHALL be authorized by the `ATTEND_SHIFT_MANAGE` permission code and reading by `ATTEND_SHIFT_READ`, never a role name (invariant 5).

#### Scenario: Create a day shift in the active company

- **WHEN** an `ATTEND_SHIFT_MANAGE` user creates a `work_shift` with `code` "OFFICE", start 08:00, end 17:00, and `grace_minutes` 15
- **THEN** the row is stored under the active company with `start_minute` 480, `end_minute` 1020, and `is_active` true

#### Scenario: Create a night shift that ends the next day

- **WHEN** an `ATTEND_SHIFT_MANAGE` user creates a `work_shift` starting 22:00 and ending 06:00
- **THEN** the row is stored with `start_minute` 1320 and `end_minute` 1800
- **AND** the shift reports that it crosses midnight without a stored flag

#### Scenario: End before start is rejected

- **WHEN** an `ATTEND_SHIFT_MANAGE` user creates a `work_shift` whose `end_minute` is less than or equal to its `start_minute`
- **THEN** the request is rejected and no row is created

#### Scenario: Duplicate code in the same company is rejected

- **WHEN** an `ATTEND_SHIFT_MANAGE` user creates a `work_shift` whose `code` already exists in the active company
- **THEN** the request is rejected and no row is created

#### Scenario: The same code may exist in different companies

- **GIVEN** company A has a `work_shift` with `code` "OFFICE"
- **WHEN** an `ATTEND_SHIFT_MANAGE` user in company B creates a `work_shift` with `code` "OFFICE"
- **THEN** the row is created in company B and is independent of company A's

#### Scenario: Shifts are company-scoped

- **WHEN** an `ATTEND_SHIFT_READ` user lists work shifts
- **THEN** only the active company's `work_shift` rows are returned

#### Scenario: Managing shifts is permission-gated

- **WHEN** a request without `ATTEND_SHIFT_MANAGE` tries to create or update a `work_shift`
- **THEN** the request is forbidden and nothing changes

### Requirement: Weekday Pattern With Optional Per-Day Hours

The system SHALL express which weekdays a shift works through `work_shift_day` rows rather than a flag on `work_shift`. Each `work_shift_day` SHALL carry `work_shift_id`, `weekday` (1–7, ISO numbering where 1 is Monday and 7 is Sunday), `is_working`, and nullable `start_minute` and `end_minute` overrides. `weekday` SHALL be unique per shift (`(work_shift_id, weekday)`). When a day's `start_minute` or `end_minute` is null the system SHALL use the parent `work_shift` value; when set, the day's own value SHALL apply. A weekday with no `work_shift_day` row SHALL be treated as non-working.

#### Scenario: A Monday-to-Friday shift

- **WHEN** an `ATTEND_SHIFT_MANAGE` user configures weekdays 1 through 5 as working and leaves their hours null
- **THEN** those five days resolve to the shift's own `start_minute` and `end_minute`
- **AND** weekdays 6 and 7 are non-working

#### Scenario: Saturday works shorter hours

- **GIVEN** a shift running 08:00–17:00
- **WHEN** an `ATTEND_SHIFT_MANAGE` user marks weekday 6 as working with `end_minute` 720 and leaves `start_minute` null
- **THEN** Saturday resolves to 08:00–12:00 while weekdays 1–5 remain 08:00–17:00

#### Scenario: A missing weekday row is non-working

- **GIVEN** a shift with `work_shift_day` rows for weekdays 1 through 5 only
- **WHEN** the pattern is resolved for weekday 7
- **THEN** the day is non-working

#### Scenario: Duplicate weekday for one shift is rejected

- **WHEN** an `ATTEND_SHIFT_MANAGE` user adds a second `work_shift_day` for a weekday the shift already defines
- **THEN** the request is rejected and no row is created

### Requirement: Break Window Stored as an Interval

The system SHALL store a shift's unpaid break as the nullable interval `break_start_minute`–`break_end_minute` on `work_shift`, not as a flat duration. When both are set they SHALL fall within the shift's own `start_minute`–`end_minute` span, and `break_end_minute` SHALL be greater than `break_start_minute`. A shift MAY have no break, in which case both columns are null. The stored interval SHALL be the basis for deducting break time from attendance: a later daily computation deducts only the overlap between the interval actually worked and this window, so that an employee whose working time does not span the break is not charged for it.

#### Scenario: Configure a one-hour lunch break

- **WHEN** an `ATTEND_SHIFT_MANAGE` user sets the break of an 08:00–17:00 shift to 12:00–13:00
- **THEN** the shift stores `break_start_minute` 720 and `break_end_minute` 780

#### Scenario: A break outside the shift span is rejected

- **WHEN** an `ATTEND_SHIFT_MANAGE` user sets a break of 18:00–19:00 on an 08:00–17:00 shift
- **THEN** the request is rejected and the shift is unchanged

#### Scenario: A shift may have no break

- **WHEN** an `ATTEND_SHIFT_MANAGE` user creates a `work_shift` leaving both break columns null
- **THEN** the shift is stored and is treated as having no unpaid break

### Requirement: Employee Shift Assignment Over Effective Dates

The system SHALL bind an employee to a shift through `employee_shift` rows carrying `company_id`, `employee_id`, `work_shift_id`, `effective_from`, and a nullable `effective_to` where null means open-ended. The referenced `employee` and `work_shift` MUST both belong to the active company. Two `employee_shift` rows for the same employee MUST NOT cover the same date, and the system SHALL reject an assignment whose date range overlaps an existing one for that employee. The overlap check and the write SHALL occur within one database transaction so two concurrent assignments cannot both pass it. `effective_to`, when set, SHALL NOT precede `effective_from`.

#### Scenario: Assign a shift open-ended

- **WHEN** an `ATTEND_SHIFT_MANAGE` user assigns an employee to a shift with `effective_from` 2026-01-01 and no `effective_to`
- **THEN** the assignment is stored and applies to every date from 2026-01-01 onward

#### Scenario: Move an employee to a new shift

- **GIVEN** an employee assigned to shift A from 2026-01-01 with `effective_to` 2026-06-30
- **WHEN** an `ATTEND_SHIFT_MANAGE` user assigns shift B from 2026-07-01 open-ended
- **THEN** both assignments are stored and no date is covered by both

#### Scenario: Overlapping assignment is rejected

- **GIVEN** an employee assigned to shift A from 2026-01-01 open-ended
- **WHEN** an `ATTEND_SHIFT_MANAGE` user assigns shift B from 2026-03-01
- **THEN** the request is rejected and the existing assignment is unchanged

#### Scenario: Concurrent overlapping assignments do not both succeed

- **WHEN** two requests assigning overlapping ranges for the same employee are processed concurrently
- **THEN** at most one is stored and the other is rejected

#### Scenario: Assigning a shift from another company is rejected

- **WHEN** an `ATTEND_SHIFT_MANAGE` user assigns an employee to a `work_shift` belonging to a different company
- **THEN** the request is rejected and no assignment is created

### Requirement: Shift Resolution For An Employee And Date

The system SHALL resolve the shift expected of an employee on a date by taking the `employee_shift` whose range covers that date, and when none exists, the `default_work_shift_id` of the employee's department. When neither yields a shift the resolution SHALL return no shift, which is a valid result and MUST NOT be treated as an error. Resolution SHALL return the shift together with the weekday's effective `start_minute`, `end_minute`, and working flag, so a caller obtains everything needed to judge a day without re-reading configuration. Resolution SHALL consider inactive shifts so that an assignment made before a shift was deactivated still resolves.

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

### Requirement: Work Location Geofence Definition

The system SHALL provide a company-scoped `work_location` master carrying `company_id`, `code`, `name`, `latitude` and `longitude` as `decimal(9,6)`, `radius_meters`, `control_policy`, and `is_active` (default true). `code` SHALL be unique per company. `control_policy` SHALL use the existing `HARD_STOP` / `SOFT_WARNING` values and SHALL default to `SOFT_WARNING`, declaring whether a later attendance capture outside `radius_meters` is refused or accepted and recorded. `latitude` SHALL be between -90 and 90 and `longitude` between -180 and 180, and `radius_meters` SHALL be a positive integer. Coordinates SHALL be carried as decimal values and never as a floating-point number.

#### Scenario: Define a head-office geofence

- **WHEN** an `ATTEND_SHIFT_MANAGE` user creates a `work_location` with a latitude, longitude, and `radius_meters` 200
- **THEN** the row is stored under the active company with `control_policy` `SOFT_WARNING`

#### Scenario: A strict site refuses out-of-range capture

- **WHEN** an `ATTEND_SHIFT_MANAGE` user creates a `work_location` with `control_policy` `HARD_STOP`
- **THEN** the row is stored declaring that capture outside its radius is to be refused

#### Scenario: Out-of-range coordinates are rejected

- **WHEN** an `ATTEND_SHIFT_MANAGE` user creates a `work_location` with a latitude above 90 or a non-positive `radius_meters`
- **THEN** the request is rejected and no row is created

#### Scenario: Locations are company-scoped

- **WHEN** an `ATTEND_SHIFT_READ` user lists work locations
- **THEN** only the active company's `work_location` rows are returned

### Requirement: Deactivation Over Deletion For Shifts And Locations

The system SHALL let an `ATTEND_SHIFT_MANAGE` user deactivate a `work_shift` or a `work_location` by setting `is_active` false rather than hard-deleting it. A deactivated row SHALL be excluded from the option sets offered when creating new assignments or capturing attendance, but SHALL still resolve for existing references so historical records stay stable. A `work_shift` still referenced by any `employee_shift` row or by a `department.default_work_shift_id` SHALL NOT be hard-deleted.

#### Scenario: Deactivated shift leaves existing assignments intact

- **GIVEN** an employee assigned to the "OFFICE" shift
- **WHEN** an `ATTEND_SHIFT_MANAGE` user deactivates that shift
- **THEN** it no longer appears in the assignment option set but the existing assignment still resolves

#### Scenario: In-use shift cannot be hard-deleted

- **WHEN** an `ATTEND_SHIFT_MANAGE` user attempts to hard-delete a `work_shift` still referenced by an `employee_shift` or a department default
- **THEN** the deletion is rejected and the shift remains

#### Scenario: Listing excludes inactive rows by default

- **WHEN** an `ATTEND_SHIFT_READ` user lists work shifts without asking for inactive rows
- **THEN** only rows with `is_active` true are returned
