## MODIFIED Requirements

### Requirement: Real-Time Budget Balance Report by Department and Category

The system SHALL provide a budget-balance report for the active company that, for each budget,
derives the balance from `budget_txn` as amount_total + ADJUST_INCREASE − ADJUST_DECREASE +
TRANSFER_IN − TRANSFER_OUT − RESERVE + RELEASE in the company base currency, and SHALL present rows
grouped by department and by category (GL account) with their component subtotals (amount_total,
adjustments, transfers, reserved, actual, released, available). ACTUAL SHALL be reported as a
component and SHALL NOT be subtracted from available — it draws down a reservation that already
reduced the balance (invariant 3). The report SHALL support filtering by fiscal year and
department. Balances SHALL be computed fresh on each request and MUST NOT be read from a stored
balance column.

#### Scenario: Balance grouped by department and category

- **WHEN** a user runs the budget-balance report for the active company
- **THEN** each row shows a department + category with its derived available balance and component
  subtotals, summed from that group's budgets

#### Scenario: Balance reflects the ledger live

- **WHEN** a new RESERVE (or ACTUAL/RELEASE) row is appended to `budget_txn` and the report is re-run
- **THEN** the affected group's available balance reflects the change without any stored value being
  overwritten

#### Scenario: Filter by department

- **WHEN** the user filters the report by a department
- **THEN** only that department's budgets are aggregated

### Requirement: Derived Budget Figures

Budget reports SHALL derive balance and utilization by summing `budget_txn` and MUST NOT read a
stored usage value or treat `budget.amount_total` as anything other than the opening amount.

Available SHALL be derived as `amount_total + ADJUST_INCREASE − ADJUST_DECREASE + TRANSFER_IN −
TRANSFER_OUT − RESERVE + RELEASE`. ACTUAL SHALL NOT be subtracted (invariant 3).

Consumed SHALL be derived as `Σ RESERVE − Σ RELEASE` — every amount a document took from the budget
and did not give back, which is the outstanding reservations plus the settled spend. Consumed SHALL
NOT be derived as `Σ RESERVE + Σ ACTUAL`: ACTUAL draws down a reservation already counted in Σ
RESERVE, so adding it counts every settled document twice. Consumed SHALL NOT be derived as
`amount_total − available` either, because an `ADJUST_DECREASE` or `TRANSFER_OUT` removes money from
a budget without anyone consuming it. Utilization SHALL be `consumed / amount_total`.

#### Scenario: Utilization is computed from the ledger

- **GIVEN** a department budget with `amount_total` 1,000,000 and `budget_txn` summing to 250,000
  RESERVE and 0 ACTUAL
- **WHEN** the budget-utilization report runs
- **THEN** consumed is reported as 250,000 and utilization as 25%, derived from `budget_txn`

#### Scenario: A settled document is consumed once

- **GIVEN** a department budget with `amount_total` 1,000,000 whose ledger holds a RESERVE of
  100,000, an ACTUAL of 90,000 and a RELEASE of 10,000 for one completed document
- **WHEN** the budget-utilization report runs
- **THEN** consumed is 90,000 and utilization is 9% — not 190,000 and 19%

#### Scenario: Consumed and available reconcile on the same row

- **WHEN** the budget-utilization report runs for a department whose budgets carry no adjustment or
  transfer
- **THEN** consumed + available equals amount_total for that row
