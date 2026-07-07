## ADDED Requirements

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

## MODIFIED Requirements

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
