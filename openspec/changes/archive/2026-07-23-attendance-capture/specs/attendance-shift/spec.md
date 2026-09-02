## MODIFIED Requirements

### Requirement: Work Location Geofence Definition

The system SHALL provide a company-scoped `work_location` master carrying `company_id`, `code`, `name`, `latitude` and `longitude` as `decimal(9,6)`, `radius_meters`, `control_policy`, and `is_active` (default true). `code` SHALL be unique per company. `control_policy` SHALL use the existing `HARD_STOP` / `SOFT_WARNING` values and SHALL default to `SOFT_WARNING`, governing whether an attendance capture outside `radius_meters` is refused or accepted and recorded. `latitude` SHALL be between -90 and 90 and `longitude` between -180 and 180, and `radius_meters` SHALL be a positive integer. Coordinates SHALL be carried as decimal values and never as a floating-point number. Only `is_active` locations SHALL be measured against when a punch is evaluated.

#### Scenario: Define a head-office geofence

- **WHEN** an `ATTEND_SHIFT_MANAGE` user creates a `work_location` with a latitude, longitude, and `radius_meters` 200
- **THEN** the row is stored under the active company with `control_policy` `SOFT_WARNING`

#### Scenario: A strict site refuses out-of-range capture

- **WHEN** an `ATTEND_SHIFT_MANAGE` user creates a `work_location` with `control_policy` `HARD_STOP`
- **THEN** the row is stored declaring that capture outside its radius is refused

#### Scenario: Out-of-range coordinates are rejected

- **WHEN** an `ATTEND_SHIFT_MANAGE` user creates a `work_location` with a latitude above 90 or a non-positive `radius_meters`
- **THEN** the request is rejected and no row is created

#### Scenario: Locations are company-scoped

- **WHEN** an `ATTEND_SHIFT_READ` user lists work locations
- **THEN** only the active company's `work_location` rows are returned

#### Scenario: A deactivated location stops governing capture

- **GIVEN** a `work_location` that a punch would otherwise fall outside
- **WHEN** an `ATTEND_SHIFT_MANAGE` user deactivates it
- **THEN** later punches are no longer measured against it
