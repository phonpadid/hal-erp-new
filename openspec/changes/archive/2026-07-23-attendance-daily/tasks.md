## 1. Canonical Model

- [x] 1.1 Add `attendance_day` to `erp_approval_system.dbml` under section 8, with notes on why it is a projection rather than a ledger, why the shift is snapshotted but the holiday calendar is not, and why overtime is three columns
- [x] 1.2 Add the `attendance_day_status` enum (`PRESENT` / `ABSENT` / `INCOMPLETE` / `HOLIDAY` / `DAY_OFF` / `EXEMPT` / `NO_SHIFT`) to the DBML enum block, noting that `LEAVE` is reserved for the leave slice
- [x] 1.3 Add the relationship lines for `attendance_day.company_id` and `.employee_id`

## 2. Entity and Migration

- [x] 2.1 Add `AttendanceDayStatus` to `back/src/common/enums/index.ts`, with a comment recording where `LEAVE` will slot into the resolution ladder
- [x] 2.2 Add the `AttendanceDay` entity: company, employee, `shiftDate` (`columnType: 'date'`), the four snapshot columns, `firstInAt` / `lastOutAt` (`timestamptz`, nullable), `punchCount`, the six computed minute columns plus `lateOccurrences`, `status`, `computedAt`
- [x] 2.3 Declare `@Unique` on `(company, employee, shiftDate)` and `@Index` on `(company, shiftDate)`, and `[OptionalProps]` for the defaulted columns
- [x] 2.4 Do NOT add `AttendanceDay` to `LedgerGuardSubscriber` — it is a projection and recomputation must be able to overwrite it; add a one-line comment there saying so, so the omission reads as deliberate
- [x] 2.5 Write the forward migration with the unique constraint, the secondary index, foreign keys, and a status check constraint; verify forward and back on a scratch database before touching the dev database
- [x] 2.6 Run `schema:update --dump` and confirm no drift beyond hand-written check constraints
- [x] 2.7 Register the entity in `AttendanceModule`'s `forFeature`

## 3. Range-Aware Shift Resolution

- [x] 3.1 Add `ShiftResolutionService.resolveRange(employeeId, fromDate, toDate)` returning one `ResolvedShift | null` per date, loading assignments and the department default once rather than per day
- [x] 3.2 Load each shift's `work_shift_day` pattern once per shift and reuse it across the range, since a month resolves the same seven weekday rows repeatedly
- [x] 3.3 Keep the existing single-date `resolve` working unchanged, implemented in terms of the range version or alongside it
- [x] 3.4 Test: a range spanning an assignment change reports both shifts on the right sides of the boundary; a range with no assignment reports the department default throughout; a range for an unassigned employee reports null for every date

## 4. Pure Day Computation

- [x] 4.1 Create `compute-day.ts` exporting `computeDay(input) -> ComputedDay`: a pure function taking punches, the resolved shift snapshot, whether the date is a holiday, and the employee's `attendanceRequired`, returning all computed values. No `EntityManager`, no I/O
- [x] 4.2 Implement the shift window: `[expected_in − EARLY_ARRIVAL_WINDOW, expected_out + LATE_DEPARTURE_WINDOW]` as named constants with the comment from design decision 1 explaining why they are constants and where the ~18-hour limit comes from
- [x] 4.3 Implement first-in / last-out selection over the window, and the `INCOMPLETE` case where fewer than two distinct punch instants exist
- [x] 4.4 Implement worked minutes with break deduction by interval overlap, never a flat subtraction, and never negative
- [x] 4.5 Implement `late_minutes` measured from the expected start (not from the end of grace) with zero inside grace, and `late_occurrences` as 0 or 1
- [x] 4.6 Implement `early_leave_minutes`, floored at zero
- [x] 4.7 Implement the three overtime columns, applying `ot_min_minutes` as a floor and rounding DOWN to `ot_round_minutes`; select the column set by whether the date is a holiday or a shift day off
- [x] 4.8 Implement the status ladder in the order the spec fixes, leaving an explicit comment where `LEAVE` will be inserted

## 5. Computation Tests (no database)

- [x] 5.1 Worked minutes: full day deducts the whole break; morning-only deducts nothing; a partial overlap deducts only the overlap; a shift with no break deducts nothing
- [x] 5.2 Lateness: inside grace is not late; outside grace is measured from the start; exactly at the grace boundary; `late_occurrences` is 0 or 1
- [x] 5.3 Early leave: leaving early is recorded; leaving late is zero, not negative
- [x] 5.4 Overtime: below the floor is discarded; 85 minutes rounds down to 60; holiday work lands in `holiday_work_minutes`; a shift day off is holiday work; extended holiday work splits across two columns
- [x] 5.5 Night shift: a 22:00-06:00 shift with punches on consecutive dates produces ONE complete day with correct worked minutes — the case that fails if collection is by `local_date`
- [x] 5.6 Saturday half-day: a weekday override to a 12:00 end makes a 12:00 departure on-time rather than early, and work past it overtime
- [x] 5.7 Status ladder: every branch, including holiday outranking day off, exempt not being absent, and a late arrival still being `PRESENT`
- [x] 5.8 Edge cases: a single punch is `INCOMPLETE` with zero worked minutes; punches outside the window are excluded; an unresolvable shift is `NO_SHIFT`

## 6. Recompute Service

- [x] 6.1 Implement `AttendanceDayService.recomputeDay(employeeId, shiftDate)`: load punches for the window, resolve the shift, look up the holiday, call `computeDay`, upsert the row inside one `em.transactional(...)` with the projection row taken under `LockMode.PESSIMISTIC_WRITE`
- [x] 6.2 Implement `recomputeRange(employeeId, from, to)` committing per employee-day, so one failure does not roll back committed days
- [x] 6.3 Implement `recomputeCompanyDate(date)` over every employee of the active company, committing per employee-day
- [x] 6.4 Load the company's holiday set and the employee's resolved range once per recompute run rather than per day
- [x] 6.5 Confirm no code path in `AttendanceCaptureService` calls recompute — capture stays ignorant by design

## 7. DTOs, Permissions, Controller

- [x] 7.1 Add `ATTEND_DAY_READ` and `ATTEND_DAY_RECOMPUTE` to `modules/attendance/permissions.ts`
- [x] 7.2 Create the recompute DTOs (single employee-day, employee range, company date) and the list query DTO extending `PaginationQueryDto` with employee, date range, and status filters
- [x] 7.3 Create `attendance-day.controller.ts`: `POST /attendance/days/recompute`, `GET /attendance/days`, `GET /attendance/days/me`, each gated by the right code with `ParseUUIDPipe` on UUID params
- [x] 7.4 Ensure every returned row carries `computed_at`, so staleness is visible rather than assumed
- [x] 7.5 Register the controller and service in `AttendanceModule`

## 8. DB-Backed Tests

- [x] 8.1 Projection tests: a computed day produces one row; recomputing is idempotent; deleting rows and recomputing reproduces them; a second recompute updates rather than duplicates
- [x] 8.2 Snapshot tests: editing the shift does not change an already-computed row; recomputing after a shift edit does change it; a retroactively added holiday reclassifies an `ABSENT` day to `HOLIDAY`
- [x] 8.3 Night-shift test through the real service, not just the pure function, proving punches on two calendar dates land on one row
- [x] 8.4 Concurrency test: two concurrent recomputations of the same employee-day leave exactly one consistent row (write it so it would fail without the pessimistic lock, as both previous slices did)
- [x] 8.5 Range/company recompute tests: a company-wide run produces a row per employee; a range spanning an assignment change judges each side against its own shift
- [x] 8.6 Read tests: company scoping; filter by employee, range, and status; `computed_at` present; the self-service read returns only the caller's own rows
- [x] 8.7 Permission tests for every new route, in the shape of `attendance-permissions.spec.ts`
- [x] 8.8 Capture-isolation test: recording a punch writes no `attendance_day` row
- [x] 8.9 Run the full backend suite and diff typecheck errors against committed `HEAD`; report any delta rather than assuming none

## 9. Verification

- [x] 9.1 Confirm the DBML, the migration, and the entity agree on every column name of `attendance_day`
- [x] 9.2 Recompute a date for the seeded company against the dev database and inspect the resulting rows by hand — the seeded employee resolves the OFFICE shift through the department default and has no punches, so the expected result is a documented `ABSENT` (or `HOLIDAY`/`DAY_OFF` by date)
- [x] 9.3 Confirm the seed still writes no `attendance_day` rows: the projection is built by recomputation, not seeded
- [x] 9.4 Re-run `openspec validate attendance-daily`
