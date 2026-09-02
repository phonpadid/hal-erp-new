## MODIFIED Requirements

### Requirement: Quota Definition
The system SHALL define quotas in `quota` with a type, unit, limit, reset cycle, an optional department (null means company-level), a `control_policy`, and an optional `paid_limit_value`. `control_policy` SHALL use the existing `HARD_STOP` / `SOFT_WARNING` values and SHALL default to `HARD_STOP`, so a quota created without one behaves exactly as quotas did before this setting existed. `paid_limit_value` SHALL express how much of the quota is compensated, separately from `limit_value`, which expresses how much may be taken; a null `paid_limit_value` SHALL mean the whole limit is compensated. The system SHALL derive the compensated and uncompensated portions of usage rather than storing them per row: compensated is `min(net usage, paid_limit_value)` and uncompensated is the remainder.

#### Scenario: Define an annual leave quota
- GIVEN an administrator with quota management permission
- WHEN they create a quota of type ANNUAL_LEAVE, unit "day", reset YEARLY
- THEN the quota is stored and available for personal entitlements
- AND its `control_policy` is `HARD_STOP` and its `paid_limit_value` is null

#### Scenario: A quota may allow more than it pays for

- **WHEN** an administrator defines a SICK_LEAVE quota whose `paid_limit_value` is 30 and whose `limit_value` is higher
- **THEN** usage up to 30 is compensated and usage beyond it is not

#### Scenario: The compensated boundary may fall inside one reservation

- **GIVEN** an employee who has used 28 days of a quota whose `paid_limit_value` is 30
- **WHEN** they reserve 5 more days
- **THEN** 2 days are compensated and 3 are not, derived from the ledger rather than stored

#### Scenario: A quota may pay for nothing

- **WHEN** an administrator defines an unpaid-leave quota with `paid_limit_value` 0
- **THEN** no usage of it is compensated

### Requirement: Over-Quota Enforcement
The system SHALL enforce a quota's remaining balance according to that quota's `control_policy`. When the policy is `HARD_STOP` the system MUST reject a reservation that would exceed remaining and write no `quota_usage` row. When the policy is `SOFT_WARNING` the system SHALL accept the reservation, record it, and report an overshoot from the reservation call identifying the quota, the requested amount, the remaining balance, and the difference. The overshoot SHALL be returned to the caller of the reservation rather than raised, and SHALL NOT be held on the reservation service itself, which is a singleton whose per-request state would leak between concurrent requests. How far an overshoot then travels towards an end user is the concern of whichever capability calls the reservation; document submit currently records it in the log, matching what it already does with the equivalent budget warning.

#### Scenario: Leave beyond balance is blocked
- GIVEN an employee with 2 annual leave days remaining on a `HARD_STOP` quota
- WHEN they request 3 days
- THEN the system MUST reject the request as over-quota

#### Scenario: A soft-policy quota records the overshoot instead of refusing

- **GIVEN** an employee with 2 remaining days on a `SOFT_WARNING` quota
- **WHEN** they request 3 days
- **THEN** the reservation is recorded and a warning reports the quota and the 1-day overshoot

#### Scenario: An unconfigured quota still blocks

- **GIVEN** a quota created before `control_policy` existed
- **WHEN** a reservation would exceed its remaining
- **THEN** it is rejected, because the policy defaults to `HARD_STOP`

### Requirement: Concurrency-Safe Quota Reservation

The system SHALL lock the quota (and, for personal quotas, the entitlement) row within a single database transaction so that concurrent reservations compute their remaining balance serially. For a `HARD_STOP` quota, over-quota reservations MUST be rejected, so two concurrent requests for the last unit result in exactly one success. For a `SOFT_WARNING` quota both MAY succeed, and the lock SHALL still be taken so that the recorded overshoot is computed against a serialized balance rather than a stale one.

#### Scenario: Two requests for the last unit — one wins

- **GIVEN** an employee with exactly 1 remaining day on a `HARD_STOP` quota
- **WHEN** two leave requests each try to reserve 1 day at the same time
- **THEN** exactly one succeeds and the other is rejected as over-quota

#### Scenario: Over-quota is blocked

- **GIVEN** an employee with 2 remaining days on a `HARD_STOP` quota
- **WHEN** they request 3 days
- **THEN** the reservation is rejected

#### Scenario: Concurrent soft-policy reservations report honest overshoots

- **GIVEN** an employee with 1 remaining day on a `SOFT_WARNING` quota
- **WHEN** two requests each reserve 1 day concurrently
- **THEN** both are recorded and the later one's warning reflects the balance after the earlier, not before it
