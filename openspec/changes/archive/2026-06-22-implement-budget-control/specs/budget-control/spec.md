## ADDED Requirements

### Requirement: Budget Administration and Derived-Balance Query

The system SHALL let authorized users (`BUDGET_MANAGE`) create and maintain `budget`
rows (unique per `fiscal_year` + `department` + `gl_account`) and SHALL expose a
read-only derived-balance query (`BUDGET_VIEW`). `budget.amount_total` is set at
creation and SHALL NOT be overwritten to reflect usage — available balance is always
computed from `budget_txn` (invariant 3).

#### Scenario: Available balance is computed from the ledger

- **GIVEN** a budget with `amount_total` 1,000,000 and a RESERVE of 100,000
- **WHEN** the derived balance is queried
- **THEN** it returns 900,000 and `budget.amount_total` is still 1,000,000

#### Scenario: Creating a budget is permission-gated

- **WHEN** a request without `BUDGET_MANAGE` tries to create a budget
- **THEN** it is rejected with 403 before the handler runs

### Requirement: Outstanding Reservation Accounting

For a given document and budget, the outstanding reserved amount SHALL be computed as
`Σ RESERVE − Σ RELEASE − Σ ACTUAL` over that document+budget's `budget_txn` rows.
`settle` SHALL record ACTUAL for the consumed amount and RELEASE exactly the remaining
outstanding reserved; auto-release SHALL RELEASE exactly the remaining outstanding
reserved. The system MUST NOT release more than was reserved.

#### Scenario: Settle records actual and releases the exact remainder

- **GIVEN** a document holding a 100,000 reservation on a budget
- **WHEN** it is settled for an actual of 90,000
- **THEN** an ACTUAL of 90,000 and a RELEASE of 10,000 are recorded
- **AND** the outstanding reserved for that document+budget becomes 0

#### Scenario: Auto-release frees only what remains

- **GIVEN** a document with 60,000 outstanding reserved on a budget
- **WHEN** the document is rejected or cancelled
- **THEN** a RELEASE of exactly 60,000 is recorded and no further reservation remains

### Requirement: Authorized, Base-Currency Budget Operations

Every budget endpoint SHALL authorize on a permission code (never a role name). Ledger
amounts SHALL be stored in the company base currency; reserve consumes each line's
already-converted base amount (conversion happens upstream in multi-currency). All
ledger writes for one logical operation SHALL occur inside a single database
transaction.

#### Scenario: A paired transfer commits atomically

- **WHEN** a fully-approved transfer executes
- **THEN** the TRANSFER_OUT and TRANSFER_IN rows are written in one transaction, so the
  ledger is never left with only one side
