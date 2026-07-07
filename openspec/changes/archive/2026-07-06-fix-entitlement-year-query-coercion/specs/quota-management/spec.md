## MODIFIED Requirements

### Requirement: Quota and Entitlement Administration

The system SHALL let authorized users (`QUOTA_MANAGE`) maintain `quota` rows
(company-scoped; deactivated via `is_active`, never hard-deleted) and per-person
`quota_entitlement` rows, and SHALL expose a read-only derived-remaining query
(`QUOTA_VIEW`). The entitlement read SHALL accept an optional reset-period `year` as a
query parameter — coerced from its query-string form to an integer before validation —
and, when present, SHALL return only that period's `quota_entitlement` rows. Quota
reads/writes SHALL be limited to the active company.

#### Scenario: Define and query a quota balance

- **WHEN** an administrator with `QUOTA_MANAGE` creates a quota and an entitlement
- **THEN** the derived-remaining query returns `entitled + carried_over + adjusted` minus
  net usage for that employee

#### Scenario: Creating a quota is permission-gated

- **WHEN** a request without `QUOTA_MANAGE` tries to create a quota
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: Entitlement read accepts a year query parameter

- **GIVEN** a quota with `quota_entitlement` rows for a given `year`
- **WHEN** an authorized user requests the entitlement list with `year` supplied as a
  query-string value (e.g. `?quotaId=…&year=2026`)
- **THEN** the request is accepted (not rejected as a validation error) and returns the
  entitlement rows for that period

#### Scenario: Non-numeric year is rejected

- **WHEN** an authorized user requests the entitlement list with a non-numeric `year`
  (e.g. `?quotaId=…&year=abc`)
- **THEN** the request is rejected as a validation error
