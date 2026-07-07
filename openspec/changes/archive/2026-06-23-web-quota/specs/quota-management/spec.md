## ADDED Requirements

### Requirement: Derived-Balance Breakdown Query

The system SHALL provide a read that returns a quota's derived balance broken into a pool view
(`limitValue`, net `used`, `remaining`) and, when entitlement-based, a per-employee list
(employee, year, `entitled` = entitledValue + carriedOver + adjusted, net `used`, `remaining`) —
all derived from `quota_usage` and `quota_entitlement`. The read SHALL require `QUOTA_VIEW`, be
scoped to the active company, and SHALL NOT mutate any stored balance.

#### Scenario: Pool figures reconcile

- **WHEN** a `QUOTA_VIEW` user requests a quota's breakdown
- **THEN** pool remaining equals `limitValue` minus net used (Σ USE − Σ RELEASE)

#### Scenario: Per-employee remaining reconciles

- **WHEN** the breakdown includes an employee's entitlement
- **THEN** that employee's remaining equals their entitled total minus their net used

### Requirement: Usage Ledger Read

The system SHALL provide a read of a quota's `quota_usage` entries (usage type, quantity,
employee, source document, timestamp) ordered most-recent-first, under `QUOTA_VIEW`, scoped to the
active company. The read SHALL be strictly read-only.

#### Scenario: Usage entries are returned for a quota

- **WHEN** a `QUOTA_VIEW` user requests a quota's usage ledger
- **THEN** that quota's `quota_usage` rows are returned, newest first
