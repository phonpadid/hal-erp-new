## MODIFIED Requirements

### Requirement: FX Difference Goes to Accounting

When an actual payment is recorded at a rate different from the locked rate, the system SHALL compute
the FX delta as the base-actual amount (the document total at the actual rate, in base currency) minus
the base-locked amount, persist it on the payment record, and report it to accounting (the
`payment.settled` event) as an FX gain/loss. The budget `ACTUAL` SHALL remain at the locked basis and
the system MUST NOT charge the FX delta to the budget.

#### Scenario: Payment at a worse rate does not overrun budget silently

- **GIVEN** a document actualized (settled) at the locked rate
- **WHEN** the payment is recorded at a higher actual rate
- **THEN** the budget keeps its `ACTUAL` at the locked basis and the FX delta is recorded and reported
  separately as a loss
- **AND** no `budget_txn` is written for the FX difference

#### Scenario: FX delta is reported to accounting

- **WHEN** a payment with a non-zero FX delta is recorded
- **THEN** a `payment.settled` event carries the locked rate, actual rate, base amounts, delta, and kind
  for the external accounting system
