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
Creation SHALL additionally ensure the new budget is governed by at least one active
`budget_control_point`, creating one at the budget's own `account_id` and `department_id`
when none already governs it, within the same transaction as the budget insert.

A budget SHALL NOT carry an over-limit policy of its own. How strictly spending is checked is
decided by the tolerance ladder on the governing control point, so expressing it twice would let
the two disagree with no rule for which wins.

Creation MAY carry a tolerance ladder, in the same shape a control point accepts, used only for a
control point it has to create. When no ladder is given, that control point SHALL block at its
ceiling — the same behaviour the removed per-budget policy defaulted to. A request that still
carries the removed policy field SHALL be rejected rather than have it ignored: a caller that
states how spending should be controlled and is silently overruled believes it configured something
it did not.

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

#### Scenario: A newly created budget is never left uncovered

- **WHEN** a budget is created in a fiscal year that has no control point governing its account
  and department
- **THEN** a control point is created for that budget in the same transaction
- **AND** the budget is governed by at least one active control point

#### Scenario: A minted control point blocks at its ceiling by default

- **WHEN** a budget is created with no tolerance ladder and nothing already governs it
- **THEN** the control point created for it blocks at 100 percent of its ceiling

#### Scenario: A given ladder is used for the minted control point

- **WHEN** a budget is created with a ladder that warns at 100 percent, and nothing already governs
  it
- **THEN** the control point created for it warns at its ceiling rather than blocking

#### Scenario: The removed policy field is rejected, not ignored

- **WHEN** a budget is created or updated with the removed over-limit policy field
- **THEN** the request is rejected with a 400
