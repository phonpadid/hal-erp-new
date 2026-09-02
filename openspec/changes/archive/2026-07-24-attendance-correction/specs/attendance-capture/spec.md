## MODIFIED Requirements

### Requirement: Append-Only Attendance Event Ledger

The system SHALL record every punch as a row in an append-only `attendance_event` ledger that is never updated and never deleted. Each row SHALL carry `company_id`, `employee_id`, `occurred_at` (the instant, as `timestamptz`), `local_date` (the company-local calendar day the instant fell on), `direction` (`IN` or `OUT`), `source` (`WEB`, `MOBILE`, `DEVICE`, `IMPORT`, or `MANUAL`), a nullable `work_location_id`, nullable `latitude` and `longitude` as `decimal(9,6)`, a nullable `distance_meters`, `geofence_status` (`INSIDE`, `OUTSIDE`, or `UNKNOWN`), a nullable `device_id`, a nullable `remark`, a nullable `recorded_by` naming the `app_user` who entered it on another's behalf, a nullable `corrects_event_id`, and `created_at`. An attempt to UPDATE or DELETE an `attendance_event` SHALL be rejected (invariant 2). Correcting a punch SHALL be done by inserting a new row whose `corrects_event_id` names the superseded row, which SHALL remain readable. An event named by another event's `corrects_event_id` SHALL be treated as superseded: it stays in the ledger as the audit trail of what was originally recorded, but SHALL NOT be read as part of what happened. Rows SHALL never be read or written across companies (invariant 1).

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

#### Scenario: A superseded punch is no longer part of what happened

- **GIVEN** a punch that a corrective row names
- **WHEN** anything asks what was recorded for that shift day
- **THEN** the superseded punch is not counted, while remaining available as the audit trail
