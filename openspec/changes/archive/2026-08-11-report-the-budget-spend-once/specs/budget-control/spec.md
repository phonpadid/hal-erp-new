## MODIFIED Requirements

### Requirement: Derived-Balance Breakdown Query

The system SHALL provide a read that returns a budget's derived balance broken into its
components — `amount_total`, summed `ADJUST_INCREASE` / `ADJUST_DECREASE`, `TRANSFER_IN` /
`TRANSFER_OUT`, `RESERVE`, `ACTUAL`, `RELEASE`, and the resulting available — all summed from
`budget_txn` in the company base currency. `ACTUAL` SHALL be reported as a component and SHALL NOT
be subtracted from available: it draws down a reservation that already reduced the balance (see
`Append-Only Budget Ledger` and `Outstanding Reservation Accounting`), so subtracting it as well
would charge the budget twice. The read SHALL require `BUDGET_VIEW` and SHALL NOT mutate
`budget.amount_total`.

#### Scenario: Components reconcile to available

- **WHEN** a `BUDGET_VIEW` user requests a budget's breakdown
- **THEN** available equals `amount_total` + ADJUST_INCREASE − ADJUST_DECREASE + TRANSFER_IN −
  TRANSFER_OUT − RESERVE + RELEASE

#### Scenario: A settled document does not deduct twice

- **GIVEN** a budget with `amount_total` 1,000,000 whose ledger holds a RESERVE of 100,000, an
  ACTUAL of 90,000 and a RELEASE of 10,000 for one document
- **WHEN** a `BUDGET_VIEW` user requests its breakdown
- **THEN** `actual` is reported as 90,000 and available is 910,000 — not 820,000
