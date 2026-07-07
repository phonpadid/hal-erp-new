## ADDED Requirements

### Requirement: Derived-Balance Breakdown Query

The system SHALL provide a read that returns a budget's derived balance broken into its
components — `amount_total`, summed `ADJUST_INCREASE` / `ADJUST_DECREASE`, `TRANSFER_IN` /
`TRANSFER_OUT`, `RESERVE`, `ACTUAL`, `RELEASE`, and the resulting available — all summed from
`budget_txn` in the company base currency. The read SHALL require `BUDGET_VIEW` and SHALL NOT
mutate `budget.amount_total`.

#### Scenario: Components reconcile to available

- **WHEN** a `BUDGET_VIEW` user requests a budget's breakdown
- **THEN** available equals `amount_total` + ADJUST_INCREASE − ADJUST_DECREASE + TRANSFER_IN −
  TRANSFER_OUT − RESERVE − ACTUAL + RELEASE

### Requirement: Append-Only Ledger Read

The system SHALL provide a read of a budget's `budget_txn` entries (type, amount, source
document, remark, timestamp) ordered most-recent-first, under `BUDGET_VIEW`. The read SHALL be
strictly read-only and never alter the ledger.

#### Scenario: Ledger entries are returned for a budget

- **WHEN** a `BUDGET_VIEW` user requests a budget's ledger
- **THEN** that budget's `budget_txn` rows are returned, newest first

### Requirement: Company-Scoped Budget Reads

Budget reads exposed to clients (list, get, breakdown, ledger) SHALL be scoped to the active
company via the budget's fiscal year / department, so a budget belonging to another company is
never returned (invariant 1).

#### Scenario: List excludes other companies' budgets

- **WHEN** a user lists budgets while company A is active
- **THEN** only company A's budgets are returned

#### Scenario: Cross-company budget is not readable

- **WHEN** a user requests the breakdown or ledger of a budget in another company
- **THEN** the request is rejected (not found)
