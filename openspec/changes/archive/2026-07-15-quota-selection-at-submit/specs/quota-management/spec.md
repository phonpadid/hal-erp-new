## ADDED Requirements

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
