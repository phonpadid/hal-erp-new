# Attendance-Daily Specification

## Purpose
The join of expectation and observation: one `attendance_day` row per employee per shift day,
derived from the `attendance_event` ledger together with the snapshotted shift, the company
holiday calendar, and the employee's attendance flags.

A projection, not a ledger — it stands to `attendance_event` as `stock_balance` stands to
`stock_txn`, and replaying the ledger must reproduce it exactly. Punches are collected by the
shift's own window rather than by calendar date, so a night shift spanning midnight is one day
instead of two incomplete halves. The shift is snapshotted onto each row and judged against the
copy, while the holiday calendar is re-read: editing shift hours is a decision about the future
and must not rewrite past verdicts, whereas a retroactively declared holiday corrects a
misstatement about the past and should. Overtime is split into the three kinds priced differently
under Thai law, and no pay rate is stored anywhere.

## Requirements
### Requirement: Derived Daily Attendance Projection

The system SHALL maintain an `attendance_day` projection carrying one row per `(company_id, employee_id, shift_date)`, derived entirely from the `attendance_event` ledger together with the snapshotted shift, the company `holiday_calendar`, and the employee's attendance flags. Each row SHALL carry the snapshot columns `shift_code`, `expected_in_minute`, `expected_out_minute`, and `expected_minutes`; the observations `first_in_at`, `last_out_at`, and `punch_count`; the computed `worked_minutes`, `late_minutes`, `late_occurrences`, `early_leave_minutes`, `ot_normal_minutes`, `holiday_work_minutes`, and `ot_holiday_minutes`; a `status`; and `computed_at`. `(company_id, employee_id, shift_date)` SHALL be unique. The projection SHALL NOT be append-only: a recomputation overwrites it. Recomputing an unchanged day SHALL reproduce identical numbers, and the projection SHALL never be written except by recomputation. Rows SHALL never be read or written across companies.

#### Scenario: A day is projected from the ledger

- **GIVEN** an employee with a resolved shift and punches on a date
- **WHEN** the day is recomputed
- **THEN** one `attendance_day` row exists for that employee and shift date

#### Scenario: Recomputation is idempotent

- **GIVEN** a computed `attendance_day` row and an unchanged ledger
- **WHEN** the day is recomputed
- **THEN** every computed value is identical to before

#### Scenario: The projection can be rebuilt from nothing

- **GIVEN** computed rows that are then deleted
- **WHEN** the same days are recomputed
- **THEN** the rows are reproduced with the same values, because the ledger is the truth

#### Scenario: One row per employee per shift day

- **WHEN** a day is recomputed twice
- **THEN** the existing row is updated rather than a second row created

### Requirement: The Shift Is Snapshotted Onto Each Daily Row

The system SHALL copy the resolved shift's code and expected times onto the `attendance_day` row at computation time and SHALL judge lateness, early departure, and overtime against that copy rather than re-reading `work_shift`. A later edit to a `work_shift` SHALL NOT change any already-computed row until that row is recomputed. The company `holiday_calendar` SHALL NOT be snapshotted and SHALL be re-read on every recomputation.

#### Scenario: Editing a shift does not silently rewrite judged days

- **GIVEN** a computed day judged against an 08:00 start, on which the employee arrived 08:15 and was late
- **WHEN** an administrator changes the shift's start to 08:30
- **THEN** the computed row still shows the employee as late until it is recomputed

#### Scenario: The snapshot is what a recomputation of an unchanged shift reproduces

- **GIVEN** a computed day and an unchanged shift
- **WHEN** the day is recomputed
- **THEN** the snapshot columns are unchanged

#### Scenario: A retroactive holiday does reclassify

- **GIVEN** a computed working day on which an employee has no punches and is `ABSENT`
- **WHEN** that date is added to `holiday_calendar` and the day is recomputed
- **THEN** the status becomes `HOLIDAY`, because the day genuinely was a holiday

### Requirement: Punches Are Collected By The Shift Window

The system SHALL assign an `attendance_event` to a shift day by the shift's own window rather than by the event's `local_date`. For shift day D the window SHALL run from D's expected start minus an early-arrival allowance to D's expected end plus a late-departure allowance, where the expected end MAY fall on the following calendar date for a shift whose `end_minute` exceeds 1440. An event outside every window SHALL NOT contribute to any day's worked time. The system SHALL additionally exclude any event that another event's `corrects_event_id` names, and any corrective event that voids its target without replacing it, so a corrected punch is not counted alongside the punch that corrected it. Excluded events SHALL remain in the ledger and remain readable — exclusion is a reading rule, not a deletion.

#### Scenario: A night shift is one day, not two halves

- **GIVEN** an employee on a 22:00-06:00 shift for shift day D
- **WHEN** they check in at 22:05 on D and check out at 05:58 on D+1
- **THEN** both punches belong to shift day D and the row reports a complete day

#### Scenario: A day shift is unaffected

- **GIVEN** an employee on an 08:00-17:00 shift
- **WHEN** they punch in and out on the same calendar date
- **THEN** both punches belong to that shift day

#### Scenario: An early arrival is still collected

- **GIVEN** an 08:00 shift start
- **WHEN** an employee checks in at 07:30
- **THEN** the punch belongs to that shift day and is the day's `first_in_at`

#### Scenario: A departure after overtime is still collected

- **GIVEN** a 17:00 shift end
- **WHEN** an employee checks out at 20:00
- **THEN** the punch belongs to that shift day and is the day's `last_out_at`

#### Scenario: A superseded punch does not count

- **GIVEN** a punch at 08:02 that a corrective event names in its `corrects_event_id`
- **WHEN** the day is computed
- **THEN** the 08:02 punch is excluded and the corrective one is used instead

#### Scenario: A voided punch and its voiding row both drop out

- **GIVEN** a punch voided by a corrective event that supplies no replacement time
- **WHEN** the day is computed
- **THEN** neither contributes to the day

#### Scenario: A chain of corrections leaves only the last standing

- **GIVEN** an event A named by B, and B named by C
- **WHEN** the day is computed
- **THEN** only C contributes, because an event named by any other is excluded

#### Scenario: A day with no corrections computes exactly as before

- **GIVEN** a day none of whose events are named by another
- **WHEN** it is computed
- **THEN** the result is unchanged by the existence of the exclusion rule

### Requirement: Worked Minutes Deduct Only The Overlapping Break

The system SHALL compute `worked_minutes` as the interval between the day's first and last punch, less the overlap between that interval and the shift's break window. When the shift has no break window, or the worked interval does not intersect it, no deduction SHALL be made. `worked_minutes` SHALL never be negative.

#### Scenario: A full day deducts the whole break

- **GIVEN** an 08:00-17:00 shift with a 12:00-13:00 break
- **WHEN** an employee works 08:00 to 17:00
- **THEN** `worked_minutes` is 480, the nine-hour span less the one-hour break

#### Scenario: A morning-only day is not charged for lunch

- **GIVEN** the same shift and break
- **WHEN** an employee works 08:00 to 12:00
- **THEN** `worked_minutes` is 240 with no deduction, because they never sat through the break

#### Scenario: A partial overlap deducts only the overlap

- **GIVEN** the same shift and break
- **WHEN** an employee works 08:00 to 12:30
- **THEN** only the 30 minutes of break actually spanned are deducted

#### Scenario: A shift with no break deducts nothing

- **GIVEN** a shift with no break window
- **WHEN** a day is computed
- **THEN** `worked_minutes` is the full interval between first and last punch

### Requirement: Lateness And Early Departure In Minutes And Occurrences

The system SHALL compute `late_minutes` as the minutes by which the day's first punch follows the expected start, after allowing the shift's `grace_minutes`, and zero when the arrival is within grace. The system SHALL set `late_occurrences` to 1 when `late_minutes` is greater than zero and 0 otherwise, so that a count of occurrences over a period is a sum of this column. The system SHALL compute `early_leave_minutes` as the minutes by which the day's last punch precedes the expected end, and zero when it does not. Both SHALL be zero on a day that is not a working day.

#### Scenario: Arrival within grace is not late

- **GIVEN** an 08:00 start with 15 minutes of grace
- **WHEN** an employee arrives at 08:10
- **THEN** `late_minutes` is 0 and `late_occurrences` is 0

#### Scenario: Lateness is measured from the start, not from the end of grace

- **GIVEN** an 08:00 start with 15 minutes of grace
- **WHEN** an employee arrives at 08:25
- **THEN** `late_minutes` is 25 and `late_occurrences` is 1

#### Scenario: Occurrences sum over a period

- **GIVEN** a month in which an employee was late on three days
- **WHEN** `late_occurrences` is summed across that month
- **THEN** the total is 3, supporting a "late three times" rule

#### Scenario: Leaving before the expected end is recorded

- **GIVEN** a 17:00 expected end
- **WHEN** an employee's last punch is at 16:30
- **THEN** `early_leave_minutes` is 30

#### Scenario: Leaving after the expected end is not negative

- **WHEN** an employee's last punch is after the expected end
- **THEN** `early_leave_minutes` is 0

### Requirement: Raw Overtime Split By Kind

The system SHALL compute overtime in three separate columns: `ot_normal_minutes` for time worked beyond the expected end on a working day, `holiday_work_minutes` for time worked within normal hours on a company holiday or a shift day off, and `ot_holiday_minutes` for time beyond normal hours on such a day. Overtime below the shift's `ot_min_minutes` SHALL be discarded, and the remainder SHALL be rounded DOWN to a multiple of the shift's `ot_round_minutes`. These values are raw observations: they SHALL NOT be treated as an entitlement and SHALL NOT carry any pay rate or multiplier. They become a claim only when an overtime document certifies them, and whether a day has been certified SHALL be derived by relating it to those documents — never stored on the day, which must stay reproducible from the ledger and configuration alone.

#### Scenario: Overtime below the floor is discarded

- **GIVEN** a 17:00 end with `ot_min_minutes` 30
- **WHEN** an employee leaves at 17:20
- **THEN** `ot_normal_minutes` is 0

#### Scenario: Overtime is rounded down to the configured block

- **GIVEN** a 17:00 end with `ot_min_minutes` 30 and `ot_round_minutes` 30
- **WHEN** an employee leaves at 18:25
- **THEN** `ot_normal_minutes` is 60, not 85, because rounding is downward

#### Scenario: Work on a company holiday is recorded separately

- **GIVEN** a date in `holiday_calendar`
- **WHEN** an employee works that day
- **THEN** `holiday_work_minutes` is non-zero and `ot_normal_minutes` is 0

#### Scenario: Work on a shift day off is holiday work

- **GIVEN** a weekday the employee's shift does not work
- **WHEN** the employee works it
- **THEN** the time is recorded as `holiday_work_minutes`

#### Scenario: Extended work on a holiday splits across two columns

- **GIVEN** a company holiday and an employee who works beyond the shift's normal hours
- **WHEN** the day is computed
- **THEN** normal hours are `holiday_work_minutes` and the excess is `ot_holiday_minutes`

#### Scenario: No pay rate is stored

- **WHEN** any overtime is computed
- **THEN** only minutes by kind are stored, and no multiplier or amount is recorded anywhere

#### Scenario: Recorded overtime is not yet a claim

- **GIVEN** a day carrying recorded overtime with no overtime document over it
- **WHEN** the day is read
- **THEN** its minutes are present and nothing about them is certified

#### Scenario: Certification never writes to the day

- **GIVEN** a day whose overtime is certified by an approved overtime document
- **WHEN** the day is recomputed
- **THEN** its stored values are unchanged and it carries no reference to that document

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

### Requirement: Recomputation

The system SHALL provide recomputation, guarded by `ATTEND_DAY_RECOMPUTE`, for a single employee and date, for an employee over a date range, and for every employee of the active company over a date RANGE — an end date that is absent SHALL mean the start date alone, so a single-date request stays exactly what it was. A period is a range, and the action that makes one current has to be a range too. Each employee-day SHALL be computed within its own transaction with its projection row held under a pessimistic write lock, so two concurrent recomputations of the same day cannot both insert or interleave. A range or company-wide recomputation SHALL NOT be one transaction: a failure on one employee-day SHALL NOT roll back days already committed. Attendance capture SHALL NOT trigger recomputation. A date whose shift day falls inside a `CLOSED` attendance period SHALL NOT be recomputed: a single-date request for it SHALL be refused, and a range or company-wide request SHALL skip it while recomputing the dates around it. A company that has declared no periods SHALL be unaffected.

#### Scenario: Recomputing one employee-day

- **WHEN** an `ATTEND_DAY_RECOMPUTE` user recomputes one employee and date
- **THEN** that day's row is created or replaced

#### Scenario: Recomputing a company for a date

- **WHEN** an `ATTEND_DAY_RECOMPUTE` user recomputes a whole company for a date
- **THEN** a row exists for every employee of that company for that date

#### Scenario: Concurrent recomputations of one day do not conflict

- **WHEN** two recomputations of the same employee-day run concurrently
- **THEN** exactly one row exists afterwards and it is internally consistent

#### Scenario: A failure part-way through a range keeps earlier days

- **GIVEN** a range recomputation that fails on one employee-day
- **THEN** the days already committed remain, and re-running the range is safe

#### Scenario: Recomputation is permission-gated

- **WHEN** a request without `ATTEND_DAY_RECOMPUTE` attempts a recomputation
- **THEN** it is forbidden and nothing is written

#### Scenario: Recording a punch does not recompute

- **WHEN** an employee checks in
- **THEN** no `attendance_day` row is written by that request

#### Scenario: A date inside a closed period is refused

- **GIVEN** a shift date inside a `CLOSED` period
- **WHEN** a recomputation is requested for exactly that date
- **THEN** it is refused and the stored day is unchanged

#### Scenario: A range straddling a close recomputes only what is open

- **GIVEN** a range whose earlier dates fall in a closed period and whose later dates do not
- **WHEN** the range is recomputed
- **THEN** the later dates are recomputed and the closed ones are left exactly as they were

#### Scenario: A company with no periods recomputes as before

- **GIVEN** a company that has never declared a period
- **WHEN** any date is recomputed
- **THEN** it proceeds exactly as it did before periods existed

#### Scenario: Recomputing a company over a range

- **WHEN** an `ATTEND_DAY_RECOMPUTE` user recomputes a whole company from one date to another
- **THEN** every employee has a row for every date in that range

#### Scenario: An absent end date means the start date alone

- **WHEN** a company-wide recomputation is requested with no end date
- **THEN** exactly that one date is recomputed, as it was before ranges were accepted

#### Scenario: A company-wide range still commits per employee-day

- **GIVEN** a company-wide range recomputation that fails on one employee-day
- **THEN** the employee-days already committed remain, and re-running the range is safe

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
