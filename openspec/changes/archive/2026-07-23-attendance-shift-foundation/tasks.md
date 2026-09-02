## 1. Canonical Model

- [x] 1.1 Add `work_shift`, `work_shift_day`, `employee_shift`, and `work_location` to `erp_approval_system.dbml` under a new `// ---------- 8. การลงเวลาทำงาน (Attendance) ----------` section, with column notes matching the existing style
- [x] 1.2 Add `timezone` to the `company` table in the DBML with a note that it is an IANA zone name and defines the company's day boundaries
- [x] 1.3 Add `default_work_shift_id` to the `department` table in the DBML with a note that it MUST reference a `work_shift` in the same company
- [x] 1.4 Add `attendance_required` and `employment_type` to the `employee` table in the DBML, noting that `employment_type` exists because holiday work pays differently for monthly- versus daily-paid staff

## 2. Entities

- [x] 2.1 Create `back/src/modules/attendance/attendance.entities.ts` with `WorkShift` extending `CompanyScopedEntity`: `code`, `name`, `startMinute`, `endMinute` (smallint), nullable `breakStartMinute`/`breakEndMinute`, `standardMinutes`, `grace_minutes` default 15, `halfDayThresholdMinutes`, `otMinMinutes` default 30, `otRoundMinutes` default 30, `isActive` default true, unique on `(company, code)`
- [x] 2.2 Add a derived `crossesMidnight` getter on `WorkShift` returning `endMinute > 1440` — never a stored column (design decision 1)
- [x] 2.3 Add `WorkShiftDay` entity: `workShift`, `weekday` (1–7 ISO), `isWorking`, nullable `startMinute`/`endMinute`, unique on `(workShift, weekday)`
- [x] 2.4 Add `EmployeeShift` entity extending `CompanyScopedEntity`: `employee`, `workShift`, `effectiveFrom`, nullable `effectiveTo` (both `columnType: 'date'`), index on `(company, employee, effectiveFrom)`
- [x] 2.5 Add `WorkLocation` entity extending `CompanyScopedEntity`: `code`, `name`, `latitude`/`longitude` as `decimal(9,6)` carried as string, `radiusMeters` int, `controlPolicy` using the existing `ControlPolicy` enum defaulting to `SOFT_WARNING`, `isActive`
- [x] 2.6 Add `EmploymentType` enum (`MONTHLY` / `DAILY` / `HOURLY`) to `back/src/common/enums/index.ts` alongside `ControlPolicy`
- [x] 2.7 Add `timezone` (non-null string) to the `Company` entity in `multi-company/multi-company.entities.ts`
- [x] 2.8 Add `defaultWorkShift` (nullable `ManyToOne`) to the `Department` entity
- [x] 2.9 Add `attendanceRequired` (boolean default true) and `employmentType` (`@Enum`, default `MONTHLY`) to the `Employee` entity in `rbac/rbac.entities.ts`

## 3. Migration

- [x] 3.1 Create one forward migration creating `work_shift`, `work_shift_day`, `employee_shift`, and `work_location` with their unique indexes and foreign keys
- [x] 3.2 In the same migration add `company.timezone` nullable, backfill every row to `'Asia/Bangkok'`, then set it `not null`
- [x] 3.3 In the same migration add `department.default_work_shift_id` (nullable FK), `employee.attendance_required` (`not null default true`), and `employee.employment_type` (`not null default 'MONTHLY'` with a check constraint)
- [x] 3.4 Write the `down` migration to drop the four tables and the four columns, and verify the migration runs forward and back cleanly against a scratch database

## 4. Permissions and Module Wiring

- [x] 4.1 Create `back/src/modules/attendance/permissions.ts` exporting `AttendancePermissions` with `ATTEND_SHIFT_READ` and `ATTEND_SHIFT_MANAGE`, following `modules/job-level/permissions.ts`
- [x] 4.2 Register the new permission codes in `back/src/seed/seed-data.ts` and grant both to the seeded `ADMIN` role
- [x] 4.3 Create `AttendanceModule` registering the four entities and its providers, and add it to `back/src/app.module.ts` after `JobLevelModule`

## 5. DTOs

- [x] 5.1 Create work-shift DTOs accepting and returning times as `"HH:MM"` strings, converting to and from minutes at the boundary (design decision 1), with class-validator rules for the `HH:MM` format
- [x] 5.2 Validate in the shift DTO/service that `endMinute > startMinute`, and that when both break columns are set `breakEndMinute > breakStartMinute` and the window falls inside the shift span
- [x] 5.3 Create the weekday-pattern DTO accepting a list of `{ weekday, isWorking, startTime?, endTime? }`, rejecting a duplicate weekday and any weekday outside 1–7
- [x] 5.4 Create employee-shift assignment DTOs with `effectiveFrom`/`effectiveTo` date validation (`effectiveTo` not before `effectiveFrom`)
- [x] 5.5 Create work-location DTOs validating latitude -90..90, longitude -180..180, positive integer `radiusMeters`, and a valid `ControlPolicy`; carry coordinates as strings, never JS numbers
- [x] 5.6 Add `timezone` to the company create/update DTOs, validated against `Intl.supportedValuesOf('timeZone')`
- [x] 5.7 Add `attendanceRequired` and `employmentType` to the employee create/update DTOs

## 6. Services

- [x] 6.1 Implement `WorkShiftService` (create, update, list, get, deactivate) reading through `CompanyScopeService`, rejecting a duplicate `(company, code)`, and defaulting list results to `isActive: true` with an `includeInactive` option
- [x] 6.2 Implement weekday-pattern replacement on `WorkShiftService`: writing a shift's `work_shift_day` set replaces it wholesale inside one transaction, and a weekday with no row is non-working
- [x] 6.3 Implement `EmployeeShiftService.assign` performing the overlap check and the insert inside a single `em.transactional(...)`, rejecting any range that overlaps an existing assignment for that employee and any `work_shift` or `employee` from another company
- [x] 6.4 Implement `ShiftResolutionService.resolve(employeeId, date)` returning the employee assignment, else the department default, else null — never throwing on null — and returning the weekday's effective start, end, and working flag
- [x] 6.5 Make resolution include inactive shifts so an assignment made before deactivation still resolves, while list endpoints continue to exclude them
- [x] 6.6 Implement `WorkLocationService` (create, update, list, get, deactivate) with the same company scoping and deactivation behaviour
- [x] 6.7 Block hard-deleting a `work_shift` still referenced by an `employee_shift` or a `department.default_work_shift_id`, offering deactivation instead
- [x] 6.8 Validate `department.default_work_shift_id` against the same company when a department is created or updated

## 7. Controllers

- [x] 7.1 Create `attendance-shift.controller.ts` exposing work-shift CRUD plus the weekday-pattern write, guarded by `ATTEND_SHIFT_MANAGE` for writes and `ATTEND_SHIFT_READ` for reads, with `ParseUUIDPipe` on UUID params
- [x] 7.2 Create the employee-shift assignment endpoints (assign, list by employee, end an assignment) under the same guards
- [x] 7.3 Create `work-location.controller.ts` exposing work-location CRUD under the same guards
- [x] 7.4 Confirm every new endpoint resolves its company from the active-company context and never accepts a company id from the caller

## 8. Tests

- [x] 8.1 Work-shift service tests: create, duplicate code rejected per company, same code allowed in two companies, `end <= start` rejected, night shift stores `endMinute > 1440` and reports crossing midnight, company-scoped listing
- [x] 8.2 Break-window tests: valid break stored as minutes, break outside the shift span rejected, null break accepted
- [x] 8.3 Weekday-pattern tests: Monday–Friday resolves to the shift's own hours, a Saturday row overriding `endMinute` resolves to the shorter day, a missing weekday is non-working, duplicate weekday rejected
- [x] 8.4 Assignment tests: open-ended assign, consecutive non-overlapping ranges both stored, overlapping range rejected, cross-company shift or employee rejected, `effectiveTo` before `effectiveFrom` rejected
- [x] 8.5 Concurrency test: two overlapping assignments for the same employee issued concurrently — at most one is stored (guards the transactional overlap check from design decision 8)
- [x] 8.6 Resolution tests: personal assignment beats department default, department default applies with no assignment, null returned and no error when neither exists, weekday override reflected in the result, deactivated shift still resolves for an existing assignment
- [x] 8.7 Work-location tests: defaults to `SOFT_WARNING`, `HARD_STOP` stored when set, out-of-range latitude and non-positive radius rejected, coordinates round-trip as strings without float drift
- [x] 8.8 Deactivation tests: deactivated shift excluded from listings but still resolving, in-use shift refuses hard delete
- [x] 8.9 Permission tests: every write endpoint returns 403 without `ATTEND_SHIFT_MANAGE`, and reads return 403 without `ATTEND_SHIFT_READ`
- [x] 8.10 Company/employee field tests: unrecognised `timezone` rejected, valid IANA zone accepted, unknown `employment_type` rejected, and an `attendance_required` false employee stored
- [x] 8.11 Run the full backend suite and compare failures against pristine `HEAD` before attributing any to this change

## 9. Seed and Verification

- [x] 9.1 Seed an `OFFICE` work shift for the demo company: 08:00–17:00, break 12:00–13:00, `standardMinutes` 480, grace 15, weekdays 1–5 working
- [x] 9.2 Seed one `work_location` for the demo company with `SOFT_WARNING` and a 200 m radius
- [x] 9.3 Set the seeded departments' `default_work_shift_id` to the `OFFICE` shift and leave at least one employee without an individual assignment so the default path is exercised
- [x] 9.4 Re-run `openspec validate attendance-shift-foundation` and confirm the DBML, migration, and entities agree on every column name
