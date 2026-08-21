## MODIFIED Requirements

### Requirement: Real-Time Budget Balance Report by Department and Category

The system SHALL provide a budget-balance report for the active company that, for each budget,
derives the balance from `budget_txn` as amount_total + ADJUST_INCREASE − ADJUST_DECREASE +
TRANSFER_IN − TRANSFER_OUT − RESERVE + RELEASE in the company base currency, and SHALL present rows
grouped by department and by **budget node** with their component subtotals (amount_total,
adjustments, transfers, reserved, actual, released, available). A node's subtotal SHALL be the sum
over every budget beneath it in the `budget_node.parent_id` tree, so a category row states what that
category has spent and a department row what the department has. A node holds no figures of its own
to add — it is structure, not money — so nothing in the tree is counted twice.

Grouping by GL account is withdrawn. One account is charged by several budgets and one budget posts
to several accounts, so an account no longer names a group anyone can act on: the money under
`658.0007` belongs partly to fuel, partly to repairs and partly to registration, split by decisions
recorded per transaction. The question this report answers is about the budget node, which is the
question the organisation asks and the level at which its spending is actually controlled.

ACTUAL SHALL be reported as a component and SHALL NOT be subtracted from available — it draws down a
reservation that already reduced the balance (invariant 3). The report SHALL support filtering by
fiscal year and department. Balances SHALL be computed fresh on each request and MUST NOT be read
from a stored balance column.

#### Scenario: Balance grouped by department and budget node

- **WHEN** a user runs the budget-balance report for the active company
- **THEN** each row shows a department + budget node with its derived available balance and
  component subtotals, summed from the budgets beneath that node

#### Scenario: A category row totals its children

- **GIVEN** a category node with three budgets beneath it carrying reservations
- **WHEN** the report is run
- **THEN** the category row's reserved subtotal is the sum of its children's

#### Scenario: One account across several budgets is not collapsed

- **GIVEN** two budgets in one department that both record `gl_account` `658.0007`
- **WHEN** the report is run
- **THEN** the two appear as separate rows under their own nodes and are not merged into an
  account-level row

#### Scenario: Balance reflects the ledger live

- **WHEN** a new RESERVE (or ACTUAL/RELEASE) row is appended to `budget_txn` and the report is re-run
- **THEN** the affected group's available balance reflects the change without any stored value being
  overwritten

#### Scenario: Filter by department

- **WHEN** the user filters the report by a department
- **THEN** only that department's budgets are aggregated
