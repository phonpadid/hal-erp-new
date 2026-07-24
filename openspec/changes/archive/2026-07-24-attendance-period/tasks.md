## 1. Canonical Model

- [x] 1.1 Add `attendance_period` to `erp_approval_system.dbml` under section 8, with a note on why the range is explicit dates rather than a year+month, referencing the 26th-to-25th payroll cut-off
- [x] 1.2 Add `attendance_period_line`, noting that it is a SNAPSHOT and not a ledger — a re-close must overwrite it — and why `employment_type` and the affects-pay flag are stamped onto it rather than read live
- [x] 1.3 Add `attendance_period_leave`, with a note that leave types are per-company configuration so a column per type is impossible
- [x] 1.4 Add `attendance_period_log`, noting it IS append-only and joins `budget_txn` and `approval_log` under the guard
- [x] 1.5 Add the `attendance_period_status` (`DRAFT` / `CLOSED`) and `period_action` (`CLOSE` / `REOPEN`) enums
- [x] 1.6 Add `department.attendance_affects_pay` (not null, default true) and `employee.attendance_affects_pay` (nullable = inherit), with a note that nullable is what makes "inherit" expressible
- [x] 1.7 Add the relationship lines for every new foreign key

## 2. Entities and Migration

- [x] 2.1 Add `AttendancePeriodStatus` and `PeriodAction` to `back/src/common/enums/index.ts`
- [x] 2.2 Add the `AttendancePeriod` entity: company, code, `periodStart`/`periodEnd` (`columnType: 'date'`), status, with `[OptionalProps]` for the DB-defaulted status
- [x] 2.3 Add `AttendancePeriodLine`: period, employee, the minute and day totals, `lateOccurrences` separate from `lateMinutes`, the three certified OT columns, `uncertifiedOtMinutes`, stamped `employmentType` and `attendanceAffectsPay`
- [x] 2.4 Add `AttendancePeriodLeave`: line, quota, `days` as `decimal(15,2)` carried as a string
- [x] 2.5 Add `AttendancePeriodLog`: period, action, actedBy, actedAt, reason
- [x] 2.6 Add `department.attendanceAffectsPay` (default true) and `employee.attendanceAffectsPay` (nullable), adding each to its entity's `[OptionalProps]`
- [x] 2.7 Register `AttendancePeriodLog` in `LedgerGuardSubscriber`; deliberately do NOT register the line or leave tables, and say why in the code
- [x] 2.8 Write the migration: four tables, the two columns, check constraints for `period_end >= period_start`, non-negative minutes, and a reason being present on a `REOPEN` log row. Verify forward and back on a scratch database, then apply to dev
- [x] 2.9 Run `schema:update --dump` and confirm no drift beyond hand-written check constraints
- [x] 2.10 Register the entities in `AttendanceModule` and confirm the test ORM picks them up

## 3. Declaring A Period

- [x] 3.1 Implement `AttendancePeriodService.declare`: validate the range, enforce non-overlap against the company's existing periods, store as `DRAFT`
- [x] 3.2 Enforce non-overlap inside a transaction with the company's periods locked, so two concurrent declarations cannot both pass the check
- [x] 3.3 Implement `update` for a `DRAFT` period and refuse it for a `CLOSED` one
- [x] 3.4 Implement `periodCovering(companyId, date)` — the single query every gate below uses. One implementation, not four

## 4. The Closed-Period Gate

- [x] 4.1 Implement `AttendancePeriodGuard.assertOpen(companyId, date)` and `assertRangeOpen(companyId, from, to)`, throwing a message that NAMES the period so a requester knows to ask for a reopen
- [x] 4.2 Make it return quietly when the company has declared no periods, so nothing changes for a company that never adopts them
- [x] 4.3 Call it from `AttendanceDayService.recomputeDay` (refuse) and `recomputeRange` / `recomputeCompanyDate` (skip the closed dates, recompute the rest)
- [x] 4.4 Call it from `TimeCorrectionService.create`, after the rolling window check so the more specific message wins
- [x] 4.5 Call it from `LeaveRequestService.create` over the whole requested range, rejecting a straddling request in full
- [x] 4.6 Call it from `OvertimeClaimService.create` and `submit` over the claim's range
- [x] 4.7 Confirm `AttendanceCaptureService` does NOT call it — the ledger stays open — and leave a comment saying so, since its absence is a decision and not an oversight
- [x] 4.8 Implement the read that lists `attendance_event` rows whose shift date falls inside a closed period, so an inert punch is findable rather than silent

## 5. Closing

- [x] 5.1 Implement `close(periodId)`: take the period `FOR UPDATE`, refuse if already `CLOSED`, write the lines, the leave children and the log row, and flip the status — all in one transaction
- [x] 5.2 Implement the summariser: fold each employee's `attendance_day` rows in the range into expected/worked minutes, the four day counts, late minutes, late occurrences and early-leave minutes
- [x] 5.3 Derive certified overtime per DATE from `attendance_day` for the dates an approved claim covers, using `OvertimeClaimService.claimedDates` — never by summing claim totals, so a straddling claim splits at the boundary
- [x] 5.4 Sum the remaining recorded overtime into one `uncertifiedOtMinutes` total, deliberately not split by kind
- [x] 5.5 Count leave days per quota using the leave slice's own counting, so a half day counts as half of THAT day
- [x] 5.6 Stamp `employmentType` and the resolved `attendanceAffectsPay` onto the line
- [x] 5.7 Implement the affects-pay resolution: the employee's value when set, the department's otherwise
- [x] 5.8 Implement `reopen(periodId, reason)`: require the reason, flip to `DRAFT`, append the log row
- [x] 5.9 Make a re-close replace the previous lines and leave rows rather than adding to them

## 6. Permissions, DTOs, Controller

- [x] 6.1 Add `ATTEND_PERIOD_READ`, `ATTEND_PERIOD_MANAGE`, `ATTEND_PERIOD_CLOSE`, `ATTEND_PERIOD_REOPEN` to the attendance permission codes
- [x] 6.2 Create the period DTOs (declare, update, reopen-with-reason, list query) with class-validator rules mirroring the model
- [x] 6.3 Create `attendance-period.controller.ts`: declare, update, close, reopen, list, read one with its lines, read the log, and the closed-period event read — each gated by the code for what it does, with `ParseUUIDPipe` on UUID params
- [x] 6.4 Extend the employee DTOs and service to accept and clear `attendanceAffectsPay`, and the department DTOs to set theirs
- [x] 6.5 Extend `attendance-permissions.spec.ts` to enumerate the new routes

## 7. Tests

- [x] 7.1 Period tests: a calendar month and a 26th-to-25th cut-off both store as given; an overlapping period is rejected; a gap is allowed; a reversed range is rejected
- [x] 7.2 Concurrency test: two concurrent declarations of overlapping periods leave exactly one
- [x] 7.3 Concurrency test: two concurrent closes of one period leave exactly one complete set of lines
- [x] 7.4 Summariser unit tests over fixture days: expected vs worked minutes, the four day counts, late minutes AND occurrences kept apart, early-leave minutes
- [x] 7.5 The straddling-claim test: a period ending on the 25th and a claim covering the 24th–27th certifies only the 24th and 25th
- [x] 7.6 Uncertified overtime: days with recorded overtime and no approved claim appear only in the single total
- [x] 7.7 Leave tests: two types produce two rows; a half day on a half-day Saturday shift counts 0.5; no paid/unpaid classification appears anywhere on the line
- [x] 7.8 Stamping tests: changing `employment_type` after a close does not change the closed line
- [x] 7.9 Gate tests: a closed date refuses recompute; a range straddling the close recomputes only the open dates; a correction, a leave request and an OT claim into a closed period are each rejected with the period named
- [x] 7.10 The ledger-stays-open test: a punch for a closed day is stored, and the closed-period event read finds it
- [x] 7.11 Reopen tests: a reason is required; `ATTEND_PERIOD_CLOSE` alone cannot reopen; the log is append-only; a re-close after a correction reports the corrected figures and the log carries all three actions
- [x] 7.12 Affects-pay tests: inheritance from the department, the per-person override, and that neither changes a single attendance figure
- [x] 7.13 The no-periods test: a company that has declared no period behaves byte-identically to before this slice
- [x] 7.14 Permission tests for every new route
- [x] 7.15 Run the full backend suite as a SINGLE run — do not start a second vitest process while one is live, because they share the test database and produce false failures — and diff typecheck errors against committed `HEAD`

## 8. Seed and Verification

- [x] 8.1 Seed a closed period and an open one for the demo company, so both sides of every gate are visible in dev data
- [x] 8.2 Verify against the dev database that closing produces lines whose figures match the days they summarise, and that a correction into the closed period is refused by name
- [x] 8.3 Verify against the dev database that reopening, correcting and re-closing changes the line and leaves three log rows
- [x] 8.4 Confirm the DBML, the migration and the entities agree on every column of all four new tables
- [x] 8.5 Confirm no `attendance_event` row was refused, updated or deleted by any path in this slice
- [x] 8.6 Re-run `openspec validate` for the change and for every spec it touches
