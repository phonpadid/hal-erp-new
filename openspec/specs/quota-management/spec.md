# Quota Management Specification

## Purpose
Allowances that may be counted in money or non-money units (leave days, OT hours,
booking counts), at company, department, or per-person level, with periodic reset
and carry-forward.
## Requirements
### Requirement: Quota Definition
The system SHALL define quotas in `quota` with a type, unit, limit, reset cycle, and
an optional department (null means company-level).

#### Scenario: Define an annual leave quota
- GIVEN an administrator with quota management permission
- WHEN they create a quota of type ANNUAL_LEAVE, unit "day", reset YEARLY
- THEN the quota is stored and available for personal entitlements

### Requirement: Personal Entitlement
For per-person quotas the system SHALL track yearly entitlement in
`quota_entitlement`, including carried-over and adjusted amounts.

#### Scenario: Seniority-based leave differs per employee
- GIVEN two employees in the same quota with different entitlements
- WHEN their balances are computed
- THEN each balance equals entitled plus carried_over plus adjusted minus usage

### Requirement: Quota Reservation Mirrors Budget
The system SHALL reserve quota on submit and release it on reject or cancel, mirroring
budget semantics, recording rows in `quota_usage`.

#### Scenario: Reject restores quota
- GIVEN a leave request reserving 3 days from an employee's quota
- WHEN the request is rejected
- THEN a releasing `quota_usage` entry restores the 3 days

### Requirement: Over-Quota Enforcement
The system MUST block a document that would exceed remaining quota when the quota is
enforced.

#### Scenario: Leave beyond balance is blocked
- GIVEN an employee with 2 annual leave days remaining
- WHEN they request 3 days
- THEN the system MUST reject the request as over-quota

### Requirement: Reset and Carry Forward

The system SHALL treat each reset period independently (per `reset_cycle`) so a new
period starts with zero net usage, and SHALL provide a quota-wide carry-forward operation
(`QUOTA_MANAGE`) that, for every entitlement in the source period of a quota, seeds the
next period's `quota_entitlement` with `carried_over` equal to the source period's derived
remaining. Carry-forward SHALL run only when the quota's carry-forward policy allows it;
when the policy forbids carry-forward, remaining SHALL NOT be carried and `carried_over`
SHALL be 0. The operation SHALL be company-scoped and idempotent for a given
source/target period.

#### Scenario: Year-end carry forward seeds the new year

- **GIVEN** a quota with carry-forward enabled and an employee with 4 unused days at year
  end
- **WHEN** the administrator runs carry-forward from 2025 to 2026
- **THEN** the employee's 2026 entitlement shows `carried_over` = 4

#### Scenario: Carry-forward disabled drops the remainder

- **GIVEN** a quota whose carry-forward policy is disabled
- **WHEN** the new period opens
- **THEN** the next period's `carried_over` is 0 and unused balance does not roll over

#### Scenario: New period resets net usage

- **GIVEN** a MONTHLY booking quota fully used in March
- **WHEN** April begins
- **THEN** April's remaining equals the full `limit_value` (March usage excluded)

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

### Requirement: Net-Usage Accounting and Auto-Release

Net usage for a quota (optionally for one employee) SHALL be computed as
`Σ USE − Σ RELEASE` over `quota_usage` **rows within the requested reset period**
(`period_year`, and `period_index` for MONTHLY/QUARTERLY). Remaining is the personal
entitlement total (or the quota's `limit_value` for company/department quotas) for that
period minus its net usage; usage from a prior period SHALL NOT reduce the current
period's remaining. On reject or cancel the system SHALL insert RELEASE rows restoring
exactly the document's outstanding USE per period, and MUST NOT release more than was
used.

#### Scenario: Reject restores the reserved quantity

- **GIVEN** a leave request that reserved 3 days from an employee's quota
- **WHEN** the request is rejected
- **THEN** a RELEASE `quota_usage` of 3 days is recorded for the same period and net
  usage returns to its prior value

#### Scenario: Prior-period usage does not reduce this period

- **GIVEN** an employee who used 5 days of an ANNUAL_LEAVE quota in 2025
- **WHEN** their 2026 remaining is computed
- **THEN** only 2026 usage is subtracted from the 2026 entitlement total

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

### Requirement: Derived-Balance Breakdown Query

The system SHALL provide a read that returns a quota's derived balance for a requested
reset period broken into a pool view (`limitValue`, net `used`, `remaining`) and, when
entitlement-based, a per-employee list (employee, year, `entitled` = entitledValue +
carriedOver + adjusted, net `used`, `remaining`) — all derived from `quota_usage` and
`quota_entitlement` and scoped to that period. The read SHALL require `QUOTA_VIEW`, be
scoped to the active company, and SHALL NOT mutate any stored balance.

#### Scenario: Pool figures reconcile

- **WHEN** a `QUOTA_VIEW` user requests a quota's breakdown for the current period
- **THEN** pool remaining equals `limitValue` minus net used (Σ USE − Σ RELEASE) in that
  period

#### Scenario: Per-employee remaining reconciles

- **WHEN** the breakdown includes an employee's entitlement for the period year
- **THEN** that employee's remaining equals their entitled total minus their net used in
  that year

### Requirement: Usage Ledger Read

The system SHALL provide a read of a quota's `quota_usage` entries (usage type, quantity,
employee, source document, timestamp) ordered most-recent-first, under `QUOTA_VIEW`, scoped to the
active company. The read SHALL be strictly read-only.

#### Scenario: Usage entries are returned for a quota

- **WHEN** a `QUOTA_VIEW` user requests a quota's usage ledger
- **THEN** that quota's `quota_usage` rows are returned, newest first

### Requirement: Context-Safe Quota Reads

Quota read operations SHALL execute within a valid EntityManager context — forking their own unit
of work when not invoked inside a caller's transaction — so the derived-balance breakdown, usage
ledger, and remaining/net-usage helpers never fail with a global-EntityManager context error.
Reads invoked inside a transaction (e.g. usage reserve/settle) SHALL continue to use the caller's
EntityManager.

#### Scenario: Quota breakdown read succeeds over HTTP

- **WHEN** a `QUOTA_VIEW` user requests a quota's breakdown via the read endpoint
- **THEN** the pool and per-employee figures are returned (not a 500 internal error)

### Requirement: Periodized Usage Stamping

Each `quota_usage` row SHALL be stamped with the reset period it belongs to (a
`period_year` and a `period_index`) derived from the quota's `reset_cycle` at reserve
time: YEARLY uses one period per year (`period_index` = 1), QUARTERLY uses 1–4, MONTHLY
uses 1–12, and NONE uses a single open period. A RELEASE row SHALL inherit the period of
the USE it offsets, so a release never crosses a period boundary.

#### Scenario: Reserve stamps the current period

- **WHEN** a document reserves quota on a MONTHLY quota in March
- **THEN** the USE row is stamped `period_index` = 3 for that `period_year`

#### Scenario: Release stays in the reserved period

- **GIVEN** a USE row stamped for Q1
- **WHEN** the document is rejected in Q2
- **THEN** the RELEASE row is stamped Q1, matching the USE it offsets

### Requirement: Mid-Year Entitlement Adjustment

The system SHALL let an authorized user (`QUOTA_MANAGE`) adjust a personal
`quota_entitlement` for a `(quota, employee, year)` by a signed delta applied to
`adjusted`, without overwriting `entitled_value` or `carried_over`. The adjustment SHALL
be company-scoped and SHALL fail if the target entitlement does not exist.

#### Scenario: Increase an employee's allowance mid-year

- **WHEN** a `QUOTA_MANAGE` user adjusts an employee's entitlement by +2 days
- **THEN** `adjusted` increases by 2 and the derived remaining grows by 2

#### Scenario: Adjustment is permission-gated

- **WHEN** a request without `QUOTA_MANAGE` attempts an adjustment
- **THEN** it is rejected with 403 before the handler runs

### Requirement: Entitlement Read

The system SHALL expose a read (`QUOTA_VIEW`) returning the `quota_entitlement` rows for a
quota — optionally filtered by `year` — each with its `entitled_value`, `carried_over`,
`adjusted`, the entitled total, net usage for that year, and derived remaining. The read
SHALL be scoped to the active company and SHALL NOT mutate stored values.

#### Scenario: List entitlements for a quota and year

- **WHEN** a `QUOTA_VIEW` user requests a quota's entitlements for 2026
- **THEN** each employee's entitled total, used, and remaining for 2026 are returned

### Requirement: Requester Quota Selection Read

The system SHALL expose a requester-facing quota read, authorized by the document-create permission
`DOC_CREATE` (not `QUOTA_VIEW`), mirroring the budget picker read `GET /budgets/selectable`. It
SHALL return the active company's active (`is_active = true`) `quota` rows, each with its `id`,
`quota_type`, `unit`, `reset_cycle`, an advisory `remaining`, and a `personal` flag that is true
when the quota has any `quota_entitlement` row. For a `personal` quota the advisory `remaining`
SHALL be the requesting user's own current-period remaining (resolved from the caller's linked
`employee`); for a pool quota it SHALL be the pool remaining for the current period. The read SHALL
be company-scoped and SHALL NOT require any finance or HR administration permission.

#### Scenario: A requester lists selectable quotas without QUOTA_VIEW

- **WHEN** a user holding `DOC_CREATE` but not `QUOTA_VIEW` requests the selectable quota read
- **THEN** the active company's active quotas are returned, each with `personal` and advisory
  `remaining`, and no authorization error occurs

#### Scenario: Personal quota reports the caller's own remaining

- **GIVEN** a personal quota on which the requesting user's employee has entitlement remaining
- **WHEN** the requester lists selectable quotas
- **THEN** that quota is flagged `personal` and its advisory `remaining` equals the requester's own
  current-period remaining

#### Scenario: Pool quota reports pool remaining

- **GIVEN** a quota with no `quota_entitlement` rows
- **WHEN** the requester lists selectable quotas
- **THEN** that quota is flagged not `personal` and its advisory `remaining` equals the pool
  remaining for the current period

