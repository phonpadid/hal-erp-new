## ADDED Requirements

### Requirement: Selectable Currencies for Document Creation

The system SHALL expose a read that returns the currencies a document creator may choose from,
authorized by the `DOC_CREATE` permission code (not `CURRENCY_VIEW`). The read SHALL return only
active currencies (`is_active = true`) and only the selection fields for each — `code`, `name`,
`symbol`, and `decimalPlaces`. This read is additive: the administrative currency reads and
writes (the paginated list including inactive currencies under `CURRENCY_VIEW`, and create /
update / deactivate under `CURRENCY_MANAGE`) remain unchanged.

#### Scenario: Creator without CURRENCY_VIEW can list selectable currencies

- **GIVEN** a user who holds `DOC_CREATE` but not `CURRENCY_VIEW`
- **WHEN** the user requests the selectable-currencies read
- **THEN** the active currencies are returned with `code`, `name`, `symbol`, and `decimalPlaces`,
  and the request is not rejected for lacking `CURRENCY_VIEW`

#### Scenario: Inactive currencies are excluded

- **GIVEN** a currency whose `is_active` is false
- **WHEN** a user requests the selectable-currencies read
- **THEN** that currency is not returned

#### Scenario: Selectable read requires DOC_CREATE

- **GIVEN** a user who holds neither `DOC_CREATE` nor `CURRENCY_VIEW`
- **WHEN** the user requests the selectable-currencies read
- **THEN** the request is rejected as unauthorized
