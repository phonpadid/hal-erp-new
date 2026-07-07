## MODIFIED Requirements

### Requirement: Budget Administration and Derived-Balance Query

The system SHALL let authorized users (`BUDGET_MANAGE`) create and maintain `budget`
rows (unique per `fiscal_year` + `department` + `gl_account`) and SHALL expose a
read-only derived-balance query (`BUDGET_VIEW`). `budget.amount_total` is set at
creation and SHALL NOT be overwritten to reflect usage — available balance is always
computed from `budget_txn` (invariant 3). A budget's `gl_account` MUST reference an
active, postable `account` in the budget's company (resolved via the chart-of-accounts
resolver); the resolved account SHALL be recorded on `budget.account_id` alongside the
`gl_account` code. Creation SHALL be rejected when the `gl_account` does not resolve.

#### Scenario: Available balance is computed from the ledger

- **GIVEN** a budget with `amount_total` 1,000,000 and a RESERVE of 100,000
- **WHEN** the derived balance is queried
- **THEN** it returns 900,000 and `budget.amount_total` is still 1,000,000

#### Scenario: Creating a budget is permission-gated

- **WHEN** a request without `BUDGET_MANAGE` tries to create a budget
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: Budget GL account must resolve to an active postable account

- **WHEN** a budget is created with a `gl_account` that has no active, postable `account`
  in the company
- **THEN** the creation is rejected with a 400 naming the unknown code

#### Scenario: Valid GL account is recorded with its account id

- **WHEN** a budget is created with a `gl_account` that resolves to an active, postable
  account
- **THEN** the budget is stored with that `gl_account` code and its `account_id` set to the
  resolved account
