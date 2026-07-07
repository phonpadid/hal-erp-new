## MODIFIED Requirements

### Requirement: Budget Controlled in Base Currency

The system SHALL convert document amounts to the company base currency for budget checks,
reservation, and approval-threshold comparison using the `BUDGET_RATE` rate type (falling back to the
daily rate when no `BUDGET_RATE` exists for the pair), and SHALL stamp this **budget base** on the
document and its lines (`budget_exchange_rate`, `budget_base_total_amount`,
`document_line.budget_base_line_amount`) at submit. Budget reservation and its conversion to actual
SHALL both use the same persisted budget base so the reserve→actual ledger stays balanced. The
document SHALL also continue to record the **daily** rate (`exchange_rate`, `base_total_amount`,
`base_line_amount`) for display and the payment FX gain/loss; the daily rate is unchanged.

#### Scenario: Foreign-currency PR reserves at the budget rate

- **GIVEN** a company with base currency LAK, a daily THB→LAK rate, and a fixed `BUDGET_RATE` THB→LAK
- **WHEN** a THB PR is submitted
- **THEN** the reservation amount equals the THB total times the `BUDGET_RATE` in LAK, while the
  document records the daily rate and its daily base

#### Scenario: Approval threshold uses the budget base

- **GIVEN** a workflow step whose band is expressed in base currency
- **WHEN** a foreign-currency document routes
- **THEN** the band is compared against the document's `budget_base_total_amount` (the budget rate),
  not the daily base

#### Scenario: Settlement matches the reserved budget base

- **WHEN** the document's budget is converted to actual on approval
- **THEN** it settles against the same budget base it reserved, leaving zero outstanding reserved

#### Scenario: No budget rate falls back to the daily rate

- **GIVEN** no `BUDGET_RATE` exists for the currency pair
- **WHEN** the document is submitted
- **THEN** the budget base equals the daily base and budget control behaves as before
