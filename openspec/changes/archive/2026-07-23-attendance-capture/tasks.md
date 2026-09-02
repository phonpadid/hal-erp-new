## 1. Canonical Model

- [x] 1.1 Add `attendance_event` to `erp_approval_system.dbml` under the existing section 8, with column notes explaining why `local_date` is stamped rather than derived and why the table is append-only
- [x] 1.2 Add the `attendance_direction`, `attendance_source`, and `geofence_status` enums to the DBML enum block, matching the style of `budget_txn_type`
- [x] 1.3 Add the new relationship lines (`attendance_event.company_id`, `.employee_id`, `.work_location_id`, `.recorded_by`, `.corrects_event_id`)

## 2. Entities and Enums

- [x] 2.1 Add `AttendanceDirection` (`IN` / `OUT`), `AttendanceSource` (`WEB` / `MOBILE` / `DEVICE` / `IMPORT` / `MANUAL`), and `GeofenceStatus` (`INSIDE` / `OUTSIDE` / `UNKNOWN`) to `back/src/common/enums/index.ts`
- [x] 2.2 Add the `AttendanceEvent` entity to `attendance.entities.ts`: company, employee, `occurredAt` (`timestamptz`), `localDate` (`columnType: 'date'`), direction, source, nullable workLocation, nullable latitude/longitude as `decimal(9,6)` carried as string, nullable `distanceMeters`, `geofenceStatus`, nullable `deviceId`/`remark`, nullable `recordedBy` (AppUser), nullable `correctsEvent` (self-reference), `createdAt`
- [x] 2.3 Declare `[OptionalProps]` for the DB-defaulted columns so fixtures need not supply them
- [x] 2.4 Index `(company, employee, localDate)` and `(company, localDate)` on the entity — the two queries the daily slice and the supervisor board will actually run
- [x] 2.5 Register `AttendanceEvent` in `LedgerGuardSubscriber`'s `APPEND_ONLY` array and extend its comment to say why attendance joins the ledger family
- [x] 2.6 Register the entity in `back/src/test/test-orm.ts` (the attendance namespace is already imported, so confirm it is picked up) and in `AttendanceModule`'s `forFeature`

## 3. Migration

- [x] 3.1 Create the forward migration creating `attendance_event` with foreign keys to `company`, `employee`, `work_location`, `app_user` (recorded_by), and itself (corrects_event_id)
- [x] 3.2 Add check constraints for `direction`, `source`, and `geofence_status`, matching how the codebase renders enums as text + check
- [x] 3.3 Create both indexes from task 2.4
- [x] 3.4 Write `down` as a plain drop, and verify the migration runs forward and back cleanly on a scratch database before applying it to the dev database
- [x] 3.5 Run `schema:update --dump` and confirm no drift on the new table beyond the hand-written check constraints

## 4. Local-Day Stamping

- [x] 4.1 Add a `CompanyClock` helper that converts an instant to the company's local `YYYY-MM-DD` using `company.timezone`, via `Intl.DateTimeFormat` with `timeZone` and `en-CA` (which formats as ISO) — no new dependency
- [x] 4.2 Unit-test the helper across a UTC+7 midnight boundary in both directions, a UTC company, and a zone that observes DST, so the conversion is proven rather than assumed
- [x] 4.3 Cache the company's timezone per request rather than re-reading `company` on every punch

## 5. Geofence Evaluation

- [x] 5.1 Add a `distanceMeters(lat1, lng1, lat2, lng2)` haversine helper that accepts decimal strings and converts to number only inside the computation, leaving stored values as strings
- [x] 5.2 Unit-test the helper against known coordinate pairs, including a zero distance and a sub-metre difference, to confirm it is accurate at geofence scale
- [x] 5.3 Implement `GeofenceService.evaluate(latitude, longitude)` returning `{ workLocation, distanceMeters, status }`: measure every active location, take the nearest, apply its `control_policy`, and return `UNKNOWN` when there are no coordinates or no active locations
- [x] 5.4 Make `HARD_STOP` outside the radius throw a `BadRequestException` naming the location and the measured distance, so the message tells the user how far off they are

## 6. Capture Service

- [x] 6.1 Implement `AttendanceCaptureService.punchSelf(direction, dto)`: resolve the caller's `employee` from `RequestContext.userId()` and the active company (the pattern `quota.service.ts` already uses), reject when there is none
- [x] 6.2 Reject a punch for an employee whose `status` is not `ACTIVE`, while allowing one whose `attendance_required` is false
- [x] 6.3 Implement the dedupe check inside `em.transactional(...)` with the employee row taken under `LockMode.PESSIMISTIC_WRITE`, rejecting the same direction within `DEDUPE_WINDOW_SECONDS` (60) and imposing no other sequence rule
- [x] 6.4 Implement `punchFor(dto)` for the on-behalf path: named employee, caller-stated `occurredAt`, forced `source` `MANUAL`, `recordedBy` set from the request context
- [x] 6.5 Implement `bulkPunch(dto)` recording one direction and instant for many employees inside a single transaction, so an invalid member rolls back the whole group
- [x] 6.6 Ensure every insert path stamps `localDate` from the company clock using that row's own `occurredAt`, so a backdated entry lands on the day it happened rather than today
- [x] 6.7 Implement `list(query)` — paged, company-scoped, filtered by employee, `localDate` range, source, and geofence status, ordered by `occurredAt`
- [x] 6.8 Implement `listOwn(date)` returning only the caller's own events for a local date

## 7. DTOs and Controller

- [x] 7.1 Create capture DTOs: optional `latitude`/`longitude` as decimal strings (never numbers), optional `deviceId`, optional `remark`, and a `source` restricted to `WEB` / `MOBILE` on the self-service path
- [x] 7.2 Create the on-behalf DTO with `employeeId`, `occurredAt` (ISO date-time), `direction`, and optional `remark`; the bulk DTO with an employee-id array plus one shared instant and direction
- [x] 7.3 Create the list query DTO extending `PaginationQueryDto` with employee, date-from, date-to, source, and geofence-status filters
- [x] 7.4 Add `ATTEND_PUNCH_SELF`, `ATTEND_PUNCH_MANAGE`, and `ATTEND_PUNCH_READ` to `modules/attendance/permissions.ts`; they reach `ADMIN` automatically through `allPermissionCodes()`
- [x] 7.5 Create `attendance-capture.controller.ts`: `POST /attendance/check-in`, `POST /attendance/check-out`, `POST /attendance/events`, `POST /attendance/events/bulk`, `GET /attendance/events`, `GET /attendance/events/me`, each gated by the right code with `ParseUUIDPipe` on UUID params
- [x] 7.6 Confirm the self-service handlers take no employee id and no timestamp from the body, so no validation bug can turn them into an impersonation route

## 8. Tests

- [x] 8.1 Ledger tests: an insert succeeds; an UPDATE of a stored event throws; a DELETE throws; a corrective row referencing a superseded one leaves both readable
- [x] 8.2 Local-day tests: a punch at 23:30 UTC for a UTC+7 company stamps the next calendar day; changing `company.timezone` afterwards leaves existing rows' `local_date` untouched
- [x] 8.3 Self-service tests: resolves the caller's own employee; rejects a caller with no employee row; ignores an employee id supplied in the body; rejects without `ATTEND_PUNCH_SELF`
- [x] 8.4 Geofence tests: inside the radius stores `INSIDE`; outside a `SOFT_WARNING` site stores `OUTSIDE` with the distance; outside a `HARD_STOP` site is refused; the nearest of two locations decides; no coordinates gives `UNKNOWN`; no active locations gives `UNKNOWN`; a deactivated location is not measured against
- [x] 8.5 Dedupe tests: a second identical punch within the window is rejected; an hour later is accepted; the opposite direction immediately after is accepted
- [x] 8.6 Concurrency test: two identical check-ins for one employee issued concurrently store exactly one event (guards the pessimistic lock from design decision 7 — write it so it would fail without the lock, as the previous slice's overlap test did)
- [x] 8.7 On-behalf tests: stores `MANUAL` with `recordedBy`; a backdated instant stamps the past `local_date`; an employee of another company is rejected; `ATTEND_PUNCH_SELF` alone is forbidden
- [x] 8.8 Bulk tests: five employees produce five rows; one cross-company member rolls back the entire request
- [x] 8.9 Employee-status tests: an `attendance_required` false employee can punch; a `RESIGNED` employee cannot
- [x] 8.10 Read tests: company-scoped listing; filter by employee and date range; self-service read returns only the caller's own; a `ATTEND_PUNCH_SELF`-only caller cannot read another employee
- [x] 8.11 Permission test enumerating every capture route, in the shape of `attendance-permissions.spec.ts`, so a handler added without a decorator fails
- [x] 8.12 Run the full backend suite and compare failures against pristine `HEAD` before attributing any to this change; confirm the typecheck error count matches baseline

## 9. Seed and Verification

- [x] 9.1 Leave the seed free of `attendance_event` rows — it is a ledger, and the existing seed deliberately writes no ledger rows
- [x] 9.2 Verify by hand against the dev database that a check-in for the seeded employee stores the expected `local_date`, geofence status, and distance relative to the seeded `HQ` location
- [x] 9.3 Confirm the DBML, the migration, and the entity agree on every column name of `attendance_event`, as the previous slice did
- [x] 9.4 Re-run `openspec validate attendance-capture`
