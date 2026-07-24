# Attendance-Period Specification

## Purpose
The moment attendance stops moving. Punches, days, leave, overtime and corrections make attendance
observable; a period makes it final — a company-declared date range that, once closed, reports the
same figures whenever it is read, because payroll has already paid on them.

A period is a declared range rather than a calendar month the code assumes, so a 26th-to-25th
payroll cut-off is as ordinary as a month. Periods of one company may not overlap, because "is this
date closed?" must have exactly one answer. Closing snapshots every employee's totals into
`attendance_period_line`, keeping late minutes and late occurrences apart — discipline counts times,
payroll counts minutes, and one figure cannot carry both. Leave is carried by type in a child table
because leave types are configuration, and the summary refuses to decide paid versus unpaid: that
boundary is an annual cumulative rule no single month can answer.

Overtime in the summary is certified overtime, re-derived per day from `attendance_day` for the
dates an approved claim covers, so a claim straddling the boundary splits correctly. Overtime nobody
certified is carried as one deliberately unsplit total, since nobody will multiply it by a rate.

The ledger stays open while the decisions that would silently do nothing are refused: a punch for a
closed day is still recorded, but the day is not recomputed, and so a correction, a leave request or
an overtime claim reaching into a closed period is rejected rather than accepted into
ineffectiveness. Reopening is allowed, because periods do get reopened before the money leaves, and
every close and reopen is an append-only log row carrying an actor and a reason. No money, no rate
and no deduction rule appears anywhere here: this slice produces minutes and days by kind, and what
multiplies them is another system.

## Requirements
### Requirement: A Period Is A Declared Date Range

The system SHALL let a company declare an attendance period as a row carrying `company_id`, a `code`, `period_start`, `period_end`, and a `status` of `DRAFT` or `CLOSED`. `period_end` SHALL NOT precede `period_start`. Two periods of one company SHALL NOT overlap, so that any shift date belongs to at most one period. Gaps between periods SHALL be allowed. A period SHALL never span companies, and periods SHALL never be read or written across companies. Declaring and editing a `DRAFT` period SHALL be authorized by `ATTEND_PERIOD_MANAGE`.

#### Scenario: A calendar month is declared

- **WHEN** an `ATTEND_PERIOD_MANAGE` user declares a period from the 1st to the last day of a month
- **THEN** the period is stored with status `DRAFT`

#### Scenario: A payroll cut-off that is not a calendar month

- **WHEN** a period is declared from the 26th of one month to the 25th of the next
- **THEN** it is stored exactly as given, because the range is explicit rather than derived from a month

#### Scenario: An overlapping period is rejected

- **GIVEN** a company with a period covering the 1st to the 31st
- **WHEN** another period covering the 20th to the 20th of the following month is declared
- **THEN** it is rejected, because a shift date would belong to two periods

#### Scenario: A gap between periods is allowed

- **GIVEN** a company with periods for June and August
- **WHEN** July is never declared
- **THEN** both periods stand and no date in July belongs to any period

#### Scenario: A reversed range is rejected

- **WHEN** a period is declared whose `period_end` precedes its `period_start`
- **THEN** it is rejected and no row is created

#### Scenario: Declaring a period is permission-gated

- **WHEN** a request without `ATTEND_PERIOD_MANAGE` declares a period
- **THEN** it is forbidden and nothing is written

### Requirement: Closing Snapshots Every Employee's Totals

The system SHALL, on closing a period, write one `attendance_period_line` per employee of the company covering that period, and SHALL set the period's status to `CLOSED`. Each line SHALL carry the expected and worked minutes, the counts of days present, absent, on leave, and not worked, the late minutes and the late occurrences as separate figures, the early-leave minutes, and the certified overtime split into `ot_normal_minutes`, `holiday_work_minutes`, and `ot_holiday_minutes`. The line SHALL also carry a single `uncertified_ot_minutes` total that is NOT split by kind. The line SHALL stamp the employee's `employment_type` and whether their attendance affects pay, so that a figure produced from a closed period does not change meaning when that configuration is later edited. The whole close — the status change, the lines, their leave children, and the log row — SHALL commit in one transaction. Closing SHALL be authorized by `ATTEND_PERIOD_CLOSE`.

#### Scenario: A line is written for each employee

- **WHEN** an `ATTEND_PERIOD_CLOSE` user closes a period
- **THEN** one line exists per employee of that company and the period's status is `CLOSED`

#### Scenario: Late minutes and late occurrences are both carried

- **GIVEN** an employee late by 10 minutes on three separate days
- **WHEN** the period is closed
- **THEN** the line reports 30 late minutes and 3 late occurrences

#### Scenario: The three overtime kinds stay separate

- **GIVEN** a period containing certified weekday overtime and certified holiday work
- **WHEN** it is closed
- **THEN** each kind is carried in its own column and no total replaces them

#### Scenario: Uncertified overtime is reported as one figure

- **GIVEN** days carrying recorded overtime that no approved claim covers
- **WHEN** the period is closed
- **THEN** the line reports those minutes as a single `uncertified_ot_minutes` total, not split by kind

#### Scenario: The pay basis is stamped, not read live

- **GIVEN** a closed period whose lines were stamped `MONTHLY`
- **WHEN** an employee's `employment_type` is later changed to `DAILY`
- **THEN** the closed line still reports `MONTHLY`

#### Scenario: A failed close leaves nothing behind

- **WHEN** closing fails part-way through
- **THEN** the period is still `DRAFT` and no lines exist

#### Scenario: Two concurrent closes do not both write lines

- **WHEN** two closes of the same period run concurrently
- **THEN** exactly one succeeds and the period has one complete set of lines

#### Scenario: Closing is permission-gated

- **WHEN** a request without `ATTEND_PERIOD_CLOSE` closes a period
- **THEN** it is forbidden and nothing is written

### Requirement: Certified Overtime Is Re-Derived Per Day

The system SHALL compute a line's certified overtime by summing, for each date in the period that an approved overtime claim covers, that date's own recorded overtime from `attendance_day` — rather than by summing the totals stored on the claims. A claim whose date range extends beyond the period SHALL contribute only its in-period dates. Overtime recorded on a date that no approved claim covers SHALL count towards `uncertified_ot_minutes` and SHALL NOT count towards the certified figures.

#### Scenario: A claim straddling the period boundary splits correctly

- **GIVEN** a period ending on the 25th and an approved claim covering the 24th to the 27th
- **WHEN** the period is closed
- **THEN** only the overtime recorded on the 24th and 25th is certified in this period

#### Scenario: Overtime nobody claimed is not certified

- **GIVEN** a day carrying recorded overtime with no approved claim over it
- **WHEN** the period is closed
- **THEN** those minutes appear only in `uncertified_ot_minutes`

#### Scenario: Certified overtime matches the days, not the claim total

- **GIVEN** an approved claim wholly inside the period
- **WHEN** the period is closed
- **THEN** the certified figures equal the sum of those days' recorded minutes, by kind

### Requirement: Leave Days Are Carried By Type

The system SHALL record a line's leave as one `attendance_period_leave` row per leave type used, carrying the quota and the number of days, rather than as fixed columns — because leave types are per-company configuration. Days SHALL be counted the way leave is already counted: per date covered by approved leave, at the half stored on the request, with a half day counting as half of that day rather than half of a fixed shift length. The system SHALL NOT decide whether those days are paid or unpaid.

#### Scenario: Two leave types in one period

- **GIVEN** an employee who took two days of sick leave and one of annual leave
- **WHEN** the period is closed
- **THEN** the line has one leave row per type, carrying 2 and 1 days

#### Scenario: A half day counts as half of that day

- **GIVEN** an employee who took the morning of a half-day Saturday shift
- **WHEN** the period is closed
- **THEN** the leave row counts 0.5 days

#### Scenario: The paid boundary is not decided here

- **WHEN** a period carrying sick leave is closed
- **THEN** the line reports days by type and carries no paid or unpaid classification

### Requirement: A Closed Period Freezes The Projection

The system SHALL NOT recompute an `attendance_day` whose `shift_date` falls inside a `CLOSED` period, so that a closed period reports the same figures whenever it is read. The system SHALL continue to accept `attendance_event` rows whose shift date falls in a closed period, because the ledger records what happened and refusing a late device upload would lose it. Such an event SHALL be discoverable through a read that lists events falling inside closed periods, so month-end has something to inspect rather than a silence.

#### Scenario: A closed day is not recomputed

- **GIVEN** a shift date inside a closed period
- **WHEN** a recomputation is requested for it
- **THEN** it is refused and the stored day is unchanged

#### Scenario: A range recomputation skips only the closed dates

- **GIVEN** a range that straddles the end of a closed period
- **WHEN** it is recomputed
- **THEN** the dates outside the closed period are recomputed and those inside are left alone

#### Scenario: A punch for a closed day is still recorded

- **WHEN** a punch is captured whose shift date falls inside a closed period
- **THEN** the `attendance_event` row is stored

#### Scenario: A punch that landed in a closed period is findable

- **GIVEN** a punch recorded for a date inside a closed period
- **WHEN** the closed-period event read is called
- **THEN** that punch is listed

#### Scenario: A period that was never declared blocks nothing

- **GIVEN** a company with no declared periods
- **WHEN** any date is recomputed
- **THEN** it proceeds exactly as it did before periods existed

### Requirement: Reopening Is Permitted And Audited

The system SHALL allow a `CLOSED` period to be reopened, returning its status to `DRAFT`, and SHALL require a reason. Reopening SHALL be authorized by `ATTEND_PERIOD_REOPEN`, which SHALL be a different permission code from closing. The system SHALL record every close and every reopen as an append-only `attendance_period_log` row carrying the action, the acting user, the instant, and the reason. Log rows SHALL never be updated or deleted. Re-closing a reopened period SHALL replace its lines with freshly computed ones.

#### Scenario: A period is reopened with a reason

- **WHEN** an `ATTEND_PERIOD_REOPEN` user reopens a closed period with a reason
- **THEN** its status returns to `DRAFT` and a log row records the action, the actor, and the reason

#### Scenario: Reopening without a reason is rejected

- **WHEN** a reopen is attempted with no reason
- **THEN** it is rejected and the period stays closed

#### Scenario: Closing permission does not grant reopening

- **WHEN** a user holding `ATTEND_PERIOD_CLOSE` but not `ATTEND_PERIOD_REOPEN` reopens a period
- **THEN** it is forbidden and the period stays closed

#### Scenario: The log is append-only

- **WHEN** any code attempts to update or delete an `attendance_period_log` row
- **THEN** the attempt is rejected and the row is unchanged

#### Scenario: Re-closing recomputes the lines

- **GIVEN** a period that was closed, reopened, and had a correction applied
- **WHEN** it is closed again
- **THEN** its lines reflect the corrected days, and the log carries all three actions

### Requirement: Whether Attendance Drives Pay Is Configuration

The system SHALL resolve whether an employee's attendance affects their pay from `employee.attendance_affects_pay` when it is set, and from their department's setting otherwise. The department setting SHALL default to true. This setting SHALL NOT change any computation: the discipline figures SHALL be produced for every employee whose attendance is required, and the setting SHALL only mark whether a line is one payroll acts on. Configuring it SHALL be authorized by the same code that manages the record it sits on.

#### Scenario: An employee inherits their department

- **GIVEN** a department whose attendance does not affect pay
- **WHEN** an employee of it has no setting of their own
- **THEN** their line is stamped as not affecting pay

#### Scenario: A person overrides their department

- **GIVEN** a department whose attendance affects pay
- **WHEN** one employee is set individually to not affect pay
- **THEN** their line is stamped as not affecting pay while their colleagues' lines are not

#### Scenario: The setting does not change the figures

- **GIVEN** two employees with the same attendance and different settings
- **WHEN** the period is closed
- **THEN** their late minutes, absences and worked minutes are identical and only the stamp differs

### Requirement: Period Reads

The system SHALL provide a paged, company-scoped read of periods and a read of one period's lines with their leave rows, both authorized by `ATTEND_PERIOD_READ`. The system SHALL also provide the log of a period. The read of punches that landed inside a closed period SHALL be paged and SHALL report its total, rather than silently returning a fixed maximum — a truncated list that does not say so reads as a complete one. A read SHALL never return a period, line or log row of another company.

#### Scenario: Listing periods

- **WHEN** an `ATTEND_PERIOD_READ` user lists periods
- **THEN** only the active company's periods are returned

#### Scenario: Reading a closed period's lines

- **WHEN** an `ATTEND_PERIOD_READ` user reads a closed period
- **THEN** its lines are returned with their leave rows

#### Scenario: Reading is permission-gated

- **WHEN** a request without `ATTEND_PERIOD_READ` reads a period
- **THEN** it is forbidden

#### Scenario: Closed-period punches are paged, not capped

- **GIVEN** more punches inside closed periods than one page holds
- **WHEN** they are read
- **THEN** a page is returned together with the total, so the reader can tell there are more

### Requirement: A Period Reports How Much Of Its Range Has Been Computed

The system SHALL report, for a period, how many employee-days in its range have no computed `attendance_day` row at all, and how many have a row computed before the most recent `attendance_event` that belongs to it. These SHALL be two separate figures, because they mean different things: one is work not yet done, the other is work overtaken by a later punch. The figures SHALL be derived on read from `computed_at` and the ledger, and SHALL NOT be stored. The read SHALL be authorized by `ATTEND_PERIOD_READ`.

#### Scenario: A range nobody computed

- **GIVEN** a period whose dates have no `attendance_day` rows
- **WHEN** its coverage is read
- **THEN** it reports the missing employee-days and reports no stale ones

#### Scenario: A range overtaken by a later punch

- **GIVEN** a computed day and a punch recorded after it was computed
- **WHEN** coverage is read
- **THEN** that employee-day is reported as stale rather than as missing

#### Scenario: A fully current range

- **GIVEN** a period whose every expected employee-day is computed after its last punch
- **WHEN** coverage is read
- **THEN** both figures are zero

#### Scenario: Coverage is not stored

- **WHEN** a day is recomputed
- **THEN** the period's coverage changes without anything having been written to the period

### Requirement: Closing Reports Its Coverage And Is Not Blocked By It

The system SHALL make a period's coverage available before it is closed, so that closing a range nobody computed is a decision rather than an accident. Closing SHALL NOT be refused on the grounds of incomplete coverage: a company whose employees are all exempt from attendance has a legitimately empty period, and refusing to close it would leave an honest period permanently open.

#### Scenario: Closing an uncomputed range is allowed

- **GIVEN** a period whose range was never computed
- **WHEN** an `ATTEND_PERIOD_CLOSE` user closes it
- **THEN** it closes, and its lines report zeroes

#### Scenario: The figures are available before closing

- **WHEN** a period is about to be closed
- **THEN** its missing and stale employee-day counts can be read first

#### Scenario: An empty period is closable

- **GIVEN** a company all of whose employees have attendance not required
- **WHEN** its period is closed
- **THEN** it closes without objection
