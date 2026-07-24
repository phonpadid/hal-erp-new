# Attendance-Capture Specification

## Purpose
The punch itself: an append-only `attendance_event` ledger, self-service check-in and check-out,
recording on another employee's behalf (the only route for staff with no login account), bulk roll
call, and geofence evaluation against the `work_location` policy `attendance-shift` defines.

Capture records; it does not judge. It computes no lateness, marks nobody absent, and reads no
shift. A punch is an observation of the world and is never revised — a wrong one is superseded by
a new row naming it — while lateness is an opinion that gets recomputed whenever the rules or the
configuration change. Each event is stamped at insert with the company-local calendar day it fell
on, so a later timezone correction cannot silently move history.

## Requirements
### Requirement: Append-Only Attendance Event Ledger

The system SHALL record every punch as a row in an append-only `attendance_event` ledger that is never updated and never deleted. Each row SHALL carry `company_id`, `employee_id`, `occurred_at` (the instant, as `timestamptz`), `local_date` (the company-local calendar day the instant fell on), `direction` (`IN` or `OUT`), `source` (`WEB`, `MOBILE`, `DEVICE`, `IMPORT`, or `MANUAL`), a nullable `work_location_id`, nullable `latitude` and `longitude` as `decimal(9,6)`, a nullable `distance_meters`, `geofence_status` (`INSIDE`, `OUTSIDE`, or `UNKNOWN`), a nullable `device_id`, a nullable `remark`, a nullable `recorded_by` naming the `app_user` who entered it on another's behalf, a nullable `corrects_event_id`, and `created_at`. An attempt to UPDATE or DELETE an `attendance_event` SHALL be rejected (invariant 2). Correcting a punch SHALL be done by inserting a new row whose `corrects_event_id` names the superseded row, which SHALL remain readable. Rows SHALL never be read or written across companies (invariant 1).

#### Scenario: A punch is stored as a ledger row

- **WHEN** an employee checks in
- **THEN** an `attendance_event` row is inserted with `direction` `IN` and the server's instant as `occurred_at`

#### Scenario: Updating a punch is rejected

- **GIVEN** a stored `attendance_event`
- **WHEN** any code attempts to update that row
- **THEN** the attempt is rejected and the row is unchanged

#### Scenario: Deleting a punch is rejected

- **GIVEN** a stored `attendance_event`
- **WHEN** any code attempts to delete that row
- **THEN** the attempt is rejected and the row remains

#### Scenario: A correction supersedes without erasing

- **GIVEN** a punch recorded at the wrong time
- **WHEN** a corrective punch is inserted naming it in `corrects_event_id`
- **THEN** both rows exist and the superseded row is still readable

### Requirement: Local Day Stamped At Capture

The system SHALL compute each event's `local_date` from `company.timezone` at the moment the row is inserted, and SHALL store it rather than deriving it when the row is read. A later change to `company.timezone` SHALL NOT alter the `local_date` of any existing `attendance_event`. `occurred_at` SHALL be retained alongside it so the stamped day can be re-derived and audited.

#### Scenario: A punch is stamped with the company's local day

- **GIVEN** a company whose `timezone` is `Asia/Bangkok`
- **WHEN** an employee punches at an instant that is 23:30 UTC
- **THEN** `local_date` is the following calendar day, because that is 06:30 local

#### Scenario: Changing the company timezone does not move history

- **GIVEN** stored punches with their `local_date` stamped
- **WHEN** an administrator changes `company.timezone`
- **THEN** every existing event keeps the `local_date` it was captured with

### Requirement: Self-Service Capture

The system SHALL provide check-in and check-out endpoints, guarded by `ATTEND_PUNCH_SELF`, that resolve the employee from the caller's own user account within the active company. These endpoints SHALL NOT accept an employee identifier and SHALL NOT accept a timestamp; `occurred_at` SHALL be the server's instant and `recorded_by` SHALL be null. They SHALL record `source` as `WEB` or `MOBILE` as declared by the client. A caller whose user account has no `employee` in the active company SHALL be rejected.

#### Scenario: An employee checks themselves in

- **WHEN** a user holding `ATTEND_PUNCH_SELF` calls check-in
- **THEN** an event is stored for that user's own employee with the server's instant

#### Scenario: A caller with no employee record is rejected

- **WHEN** a user with no `employee` in the active company calls check-in
- **THEN** the request is rejected and no event is stored

#### Scenario: Self-service cannot punch for someone else

- **WHEN** a check-in request carries an employee identifier in its body
- **THEN** the identifier is ignored and the event is stored for the caller's own employee

#### Scenario: Capture is permission-gated

- **WHEN** a request without `ATTEND_PUNCH_SELF` calls check-in
- **THEN** the request is forbidden and no event is stored

### Requirement: Geofence Evaluation At Capture

When a punch carries coordinates the system SHALL measure the distance to every active `work_location` of the company, select the nearest, and record that location, the distance in metres, and a `geofence_status`. When the distance is within the location's `radius_meters` the status SHALL be `INSIDE` and the punch accepted. When it is outside and that location's `control_policy` is `SOFT_WARNING` the status SHALL be `OUTSIDE` and the punch accepted. When it is outside and the policy is `HARD_STOP` the punch SHALL be refused. When the punch carries no coordinates, or the company has no active `work_location`, the status SHALL be `UNKNOWN` and the punch accepted. Coordinates SHALL be carried as decimal values and never as a floating-point number.

#### Scenario: A punch inside the fence is accepted

- **GIVEN** an active `work_location` with a 200 m radius
- **WHEN** an employee punches 50 m from it
- **THEN** the event is stored with `geofence_status` `INSIDE` and the measured distance

#### Scenario: A soft-policy site records the breach and accepts

- **GIVEN** an active `work_location` with `control_policy` `SOFT_WARNING` and a 200 m radius
- **WHEN** an employee punches 380 m from it
- **THEN** the event is stored with `geofence_status` `OUTSIDE` and `distance_meters` 380

#### Scenario: A strict site refuses the punch

- **GIVEN** an active `work_location` with `control_policy` `HARD_STOP` and a 200 m radius
- **WHEN** an employee punches 380 m from it
- **THEN** the request is rejected and no event is stored

#### Scenario: The nearest location decides the policy

- **GIVEN** two active `work_location` rows at different distances from the punch
- **WHEN** the punch is evaluated
- **THEN** the nearer location is recorded and its `control_policy` is the one applied

#### Scenario: A punch without coordinates is accepted as unknown

- **WHEN** an employee punches with no latitude or longitude
- **THEN** the event is stored with `geofence_status` `UNKNOWN` and no `work_location_id`

#### Scenario: A company with no configured locations accepts every punch

- **GIVEN** a company with no active `work_location`
- **WHEN** an employee punches with coordinates
- **THEN** the event is stored with `geofence_status` `UNKNOWN`

#### Scenario: A deactivated location is not measured against

- **GIVEN** a `work_location` that has been deactivated
- **WHEN** an employee punches beside it and no other location is active
- **THEN** the event is stored with `geofence_status` `UNKNOWN`

### Requirement: Duplicate Punch Rejection

The system SHALL reject a punch for the same employee in the same direction within a short dedupe window of the previous one, and SHALL NOT otherwise constrain the sequence of directions. The dedupe check and the insert SHALL occur within one transaction with the employee row held under a pessimistic write lock, so two concurrent retries cannot both find no duplicate and both insert.

#### Scenario: A double tap records once

- **WHEN** an employee sends two identical check-ins a few seconds apart
- **THEN** the first is stored and the second is rejected as a duplicate

#### Scenario: Concurrent retries store one event

- **WHEN** two identical check-in requests for one employee are processed concurrently
- **THEN** exactly one event is stored

#### Scenario: Two check-ins are allowed outside the window

- **WHEN** an employee checks in and checks in again an hour later
- **THEN** both events are stored, because capture does not judge the sequence

#### Scenario: A check-out immediately after a check-in is allowed

- **WHEN** an employee checks in and checks out seconds later
- **THEN** both events are stored, because the dedupe window applies per direction

### Requirement: Recording Attendance On Another Employee's Behalf

The system SHALL provide an endpoint, guarded by `ATTEND_PUNCH_MANAGE`, that records a punch for a named employee at a stated `occurred_at`, including an instant in the past. Such an event SHALL be stamped `source` `MANUAL` with `recorded_by` set to the acting user. The named employee MUST belong to the active company. This is the path by which an employee with no login account is recorded.

#### Scenario: A supervisor records a punch for someone else

- **WHEN** an `ATTEND_PUNCH_MANAGE` user records a punch for another employee
- **THEN** the event is stored with `source` `MANUAL` and `recorded_by` set to the acting user

#### Scenario: A past punch may be entered

- **WHEN** an `ATTEND_PUNCH_MANAGE` user records a punch with yesterday's `occurred_at`
- **THEN** the event is stored with `local_date` derived from that instant, not from today

#### Scenario: An employee of another company is rejected

- **WHEN** an `ATTEND_PUNCH_MANAGE` user records a punch for an employee of a different company
- **THEN** the request is rejected and no event is stored

#### Scenario: Recording for others requires the stronger code

- **WHEN** a user holding only `ATTEND_PUNCH_SELF` calls the on-behalf endpoint
- **THEN** the request is forbidden

#### Scenario: Manual entries are identifiable

- **WHEN** the ledger is read
- **THEN** every manually-entered punch is distinguishable by its non-null `recorded_by`

### Requirement: Bulk Roll Call

The system SHALL provide an endpoint, guarded by `ATTEND_PUNCH_MANAGE`, that records the same direction and instant for several employees in one request. All rows SHALL be inserted within one transaction so the group is recorded completely or not at all. Every named employee MUST belong to the active company.

#### Scenario: A supervisor checks in a crew

- **WHEN** an `ATTEND_PUNCH_MANAGE` user records a check-in for five employees at one instant
- **THEN** five events are stored, each with `source` `MANUAL` and `recorded_by` set

#### Scenario: One invalid employee rolls back the whole group

- **WHEN** a bulk request names an employee of a different company alongside valid ones
- **THEN** the request is rejected and no event from that request is stored

### Requirement: Attendance Status Governs Capture

The system SHALL accept a punch for an employee whose `attendance_required` is false, storing it like any other, because that flag governs absence reporting rather than data capture. The system SHALL reject a punch for an employee whose `status` is not `ACTIVE`.

#### Scenario: An exempt employee's punch is still recorded

- **GIVEN** an employee with `attendance_required` false
- **WHEN** they check in
- **THEN** the event is stored

#### Scenario: A resigned employee cannot be punched for

- **GIVEN** an employee whose `status` is `RESIGNED`
- **WHEN** a punch is recorded for them
- **THEN** the request is rejected and no event is stored

### Requirement: Attendance Event Reads

The system SHALL provide a paged, company-scoped read of `attendance_event`, guarded by `ATTEND_PUNCH_READ`, filterable by employee, `local_date` range, `source`, and `geofence_status`, ordered by `occurred_at`. The system SHALL additionally provide a self-service read, guarded by `ATTEND_PUNCH_SELF`, returning the caller's own events for a given `local_date` so a client can show whether a check-in is already registered. The ledger SHALL be indexed on `(company_id, employee_id, local_date)` and on `(company_id, local_date)`.

#### Scenario: Reading one employee's day

- **WHEN** an `ATTEND_PUNCH_READ` user lists events for an employee and a `local_date`
- **THEN** only that employee's events for that day are returned, ordered by `occurred_at`

#### Scenario: Reads are company-scoped

- **WHEN** an `ATTEND_PUNCH_READ` user lists events
- **THEN** only the active company's events are returned

#### Scenario: An employee reads their own day without the reader code

- **WHEN** a user holding only `ATTEND_PUNCH_SELF` reads their own events for today
- **THEN** their own events are returned

#### Scenario: Self-service read cannot reach another employee

- **WHEN** a user holding only `ATTEND_PUNCH_SELF` requests another employee's events
- **THEN** the request is forbidden
