## ADDED Requirements

### Requirement: A Document Reserves What It Costs, Tax Included

The amount a document reserves, settles to actual, and releases SHALL be its tax-inclusive base — the
same stamped `budget_base_line_amount` throughout.

Reserve, actual and release SHALL all read that one stamped figure, so the three can never be taken
on different bases and leave an outstanding remainder that belongs to nobody. A document whose lines
carry no tax reserves exactly what it reserved before this rule.

The stamped basis SHALL NOT be recomputed for a document already submitted. What a reservation means
is what it meant when it was taken, and a rule that reached backwards would silently restate every
budget in flight.

#### Scenario: The reserve, the actual and the release agree

- **GIVEN** a taxed document that reserved its tax-inclusive base
- **WHEN** it completes and settles
- **THEN** the `ACTUAL` is that same figure and nothing is left outstanding

#### Scenario: A document already submitted keeps its basis

- **GIVEN** a document submitted before this rule, holding a pre-tax reservation
- **WHEN** it completes
- **THEN** it settles the amount it reserved, and no budget is restated behind anyone
