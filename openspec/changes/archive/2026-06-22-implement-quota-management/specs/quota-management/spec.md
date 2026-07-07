## ADDED Requirements

### Requirement: Quota and Entitlement Administration

The system SHALL let authorized users (`QUOTA_MANAGE`) maintain `quota` rows
(company-scoped; deactivated via `is_active`, never hard-deleted) and per-person
`quota_entitlement` rows, and SHALL expose a read-only derived-remaining query
(`QUOTA_VIEW`). Quota reads/writes SHALL be limited to the active company.

#### Scenario: Define and query a quota balance

- **WHEN** an administrator with `QUOTA_MANAGE` creates a quota and an entitlement
- **THEN** the derived-remaining query returns `entitled + carried_over + adjusted` minus
  net usage for that employee

#### Scenario: Creating a quota is permission-gated

- **WHEN** a request without `QUOTA_MANAGE` tries to create a quota
- **THEN** it is rejected with 403 before the handler runs

### Requirement: Net-Usage Accounting and Auto-Release

Net usage for a quota (optionally for one employee) SHALL be computed as
`Σ USE − Σ RELEASE` over `quota_usage`. Remaining is the personal entitlement total (or
the quota's `limit_value` for company/department quotas) minus net usage. On reject or
cancel the system SHALL insert RELEASE rows restoring exactly the document's outstanding
USE, and MUST NOT release more than was used.

#### Scenario: Reject restores the reserved quantity

- **GIVEN** a leave request that reserved 3 days from an employee's quota
- **WHEN** the request is rejected
- **THEN** a RELEASE `quota_usage` of 3 days is recorded and net usage returns to its
  prior value

### Requirement: Concurrency-Safe Quota Reservation

The system SHALL prevent two concurrent reservations from exceeding remaining quota by
locking the quota (and, for personal quotas, the entitlement) row within a single
database transaction. Over-quota reservations MUST be rejected.

#### Scenario: Two requests for the last unit — one wins

- **GIVEN** an employee with exactly 1 remaining day
- **WHEN** two leave requests each try to reserve 1 day at the same time
- **THEN** exactly one succeeds and the other is rejected as over-quota

#### Scenario: Over-quota is blocked

- **GIVEN** an employee with 2 remaining days
- **WHEN** they request 3 days
- **THEN** the reservation is rejected
