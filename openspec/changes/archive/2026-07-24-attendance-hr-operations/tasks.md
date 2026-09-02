## 1. Backend: Coverage, Range Recompute, Paging

- [x] 1.1 Implement `AttendancePeriodService.coverage(periodId)` returning the count of expected employee-days in the range with no `attendance_day` row, and the count whose `computed_at` precedes the newest `attendance_event` belonging to that employee-day — TWO figures, because one is work never done and the other is work overtaken
- [x] 1.2 Derive both on read from `computed_at` and the ledger; store nothing, for the reason `staleLeaveDays` stores nothing
- [x] 1.3 Expose it as `GET /attendance-periods/:periodId/coverage` under `ATTEND_PERIOD_READ`
- [x] 1.4 Widen `RecomputeCompanyDateDto` to `dateFrom` + optional `dateTo`, keeping a single-date request byte-identical in behaviour so every existing caller and spec is unaffected
- [x] 1.5 Make `recomputeCompanyDate` loop the range per employee through `recomputeRange`, so per-employee-day transactions and the closed-period skip stay exactly as they are — do NOT write a second recompute path
- [x] 1.6 Return how many employee-days were written, so a slow month reports progress rather than looking hung
- [x] 1.7 Page `eventsInClosedPeriods` into the `Paginated<T>` shape and drop the silent 500 cap — a cap that does not report itself reads as a complete list
- [x] 1.8 Extend `attendance-permissions.spec.ts` for the coverage route
- [x] 1.9 Backend tests: coverage on an uncomputed range, on a stale one, on a current one; a company range recompute; an absent `dateTo` behaving as before; a paged closed-events read reporting its total

## 2. API Layer

- [x] 2.1 Extend `front-end/src/api/attendance.ts` with `attendanceHrApi`: periods list/detail/lines/leave/log/coverage, declare, update, close, reopen, closed events
- [x] 2.2 Add the team-day reads: everyone's days with filters, recompute one employee, recompute the company over a range, stale leave days
- [x] 2.3 Add the punch reads and writes: everyone's punches with filters, punch on behalf, bulk punch
- [x] 2.4 Declare the response interfaces colocated above the object, as the other modules do
- [x] 2.5 Api tests mocking `./client` and asserting the exact params, following `api/documents.spec.ts`

## 3. Store

- [x] 3.1 Create `front-end/src/stores/attendanceHr.ts` as a SIBLING of the self-service store, options-style with a named state interface — two stores because the self-service one must stay unable to name an employee, and that property is the boundary being protected
- [x] 3.2 Period state and actions: list, one period with lines and log, coverage, declare, update, close, reopen — writes returning `boolean` and refreshing what they invalidated
- [x] 3.3 Team-day state and actions with the `total`/`page`/`limit` triple, filters, recompute one and recompute the company over a range
- [x] 3.4 Punch state and actions: list with filters, punch on behalf, bulk punch
- [x] 3.5 `requestCorrectionFor(employeeId, ...)` creating the document with `relatedEmployeeId` set, so the subject rides on the document where approvers see it
- [x] 3.6 Store tests mocking the api module and driving a real Pinia, following `stores/quota.spec.ts`

## 4. Period Screens

- [x] 4.1 `views/attendance/AttendancePeriodsView.vue` — the list with dates and status, using `PageHeader` + `card` + `AppDataTable`
- [x] 4.2 Declare and edit a draft, gated on `ATTEND_PERIOD_MANAGE`, reporting an overlap refusal with the period it clashes with
- [x] 4.3 Close, gated on `ATTEND_PERIOD_CLOSE`, showing coverage in the confirmation with the two figures stated APART
- [x] 4.4 Offer to recompute the range first when either figure is non-zero, and let the user close anyway
- [x] 4.5 Reopen, gated on `ATTEND_PERIOD_REOPEN` and requiring a reason before it sends
- [x] 4.6 `views/attendance/AttendancePeriodDetailView.vue` — lines with leave by type, late minutes AND occurrences as two columns, overtime split by kind
- [x] 4.7 Show the append-only log with actor, instant and reopen reason
- [x] 4.8 Show the punches that landed inside the closed range, paged
- [x] 4.9 Offer no control that edits a line

## 5. Team And Ledger Screens

- [x] 5.1 `views/attendance/TeamAttendanceView.vue` — everyone's days with employee, date-range and status filters
- [x] 5.2 Recompute controls gated on `ATTEND_DAY_RECOMPUTE`, for one employee and for the company over a range
- [x] 5.3 Show the server's closed-period refusal verbatim; do NOT reimplement the closed-period rule in the client
- [x] 5.4 Surface stale leave days as outstanding work
- [x] 5.5 `views/attendance/PunchLedgerView.vue` — everyone's punches with source and geofence status visible, so a hand-entered row is distinguishable
- [x] 5.6 Punch on behalf, gated on `ATTEND_PUNCH_MANAGE`
- [x] 5.7 Bulk punch behind `fb.confirm`, naming the number of employees and the instant
- [x] 5.8 "Correct this punch" from a row, creating the document with `relatedEmployeeId` — and confirm the self-service correction form gains NO subject picker
- [x] 5.9 Toasts for writes, inline `ErrorState` for failed reads

## 6. Routing, Navigation, i18n

- [x] 6.1 Add the four lazy component consts and routes with `meta.permission` — periods and detail on `ATTEND_PERIOD_READ`, team on `ATTEND_DAY_READ`, ledger on `ATTEND_PUNCH_READ`
- [x] 6.2 Add breadcrumbs referencing the nav key
- [x] 6.3 Add `NAV` entries with icon, `to`, `permission` and section — these belong under `control`, not `workspace`: they are things an administrator does about a company
- [x] 6.4 Extend `i18n/locales/en/attendance.ts` with an `hr` namespace nested by screen
- [x] 6.5 Mirror it in `la` and `zh` with the SAME key set — `la` is the default locale and the parity spec fails on a key missing anywhere
- [x] 6.6 Add the `nav.*` keys in all three locales

## 7. Tests

- [x] 7.1 Guard tests: each route reachable on its own read code and not on a neighbour's
- [x] 7.2 Period screen: close is not offered without `ATTEND_PERIOD_CLOSE`; reopen is not offered to someone holding only the close code
- [x] 7.3 Close confirmation: the missing and stale figures are shown separately, and a fully current period reports both zero
- [x] 7.4 Close proceeds when the user confirms despite a warning
- [x] 7.5 Reopen is not sent without a reason
- [x] 7.6 Period detail: leave shown by type; late minutes and occurrences as two columns; no control edits a line
- [x] 7.7 Team screen: recompute hidden without the recompute code; the server's closed-period message is shown rather than a client-side rule
- [x] 7.8 Ledger: bulk punch confirms first, naming the count and the instant; punch-on-behalf hidden without `ATTEND_PUNCH_MANAGE`
- [x] 7.9 On-behalf correction sets `relatedEmployeeId` on the document and sends no subject in the body
- [x] 7.10 Add all four views to `test/smoke/views.smoke.spec.ts`
- [x] 7.11 Assert visible text against the `la` catalogue
- [x] 7.12 Run the frontend typecheck and full test run, and diff both against `HEAD`
- [x] 7.13 Run the full backend suite as a SINGLE run — do not start a second vitest process while one is live, because they share the test database and produce false failures

## 8. Wiring And Verification

- [x] 8.1 Add a test that asks Nest to compile `AppModule`, so a provider whose module was never imported fails a test instead of failing a boot — the gap that hid a broken application for three slices while 1066 tests passed
- [x] 8.2 Start the application and confirm it boots, rather than inferring it from a green suite
- [x] 8.3 Against the dev database, declare a period, read its coverage, recompute the range, and confirm the figures fall to zero
- [x] 8.4 Close it and confirm the lines match the days they summarise
- [x] 8.5 Reopen with a reason, re-close, and confirm three log rows with actors
- [x] 8.6 Enter a punch on behalf and confirm it lands `MANUAL` with `recorded_by` set
- [x] 8.7 Raise a correction from another employee's punch and confirm `time_correction.employee_id` is the document's related employee
- [x] 8.8 Confirm the closed-events read reports a total rather than silently truncating
- [x] 8.9 Re-run `openspec validate` for the change and for every spec it touches
