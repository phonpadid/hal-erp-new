## ADDED Requirements

### Requirement: Budget List

The web app SHALL show a `BUDGET_VIEW` user the active company's budgets (name, GL account,
fiscal year, department, total, status) with the derived available balance per budget. Each
row links to the budget detail. The list SHALL NOT show budgets of other companies.

#### Scenario: Lists the company's budgets with available balance

- **WHEN** a `BUDGET_VIEW` user opens the budgets list
- **THEN** the active company's budgets are shown, each with its derived available balance

### Requirement: Budget Balance Breakdown

The web app SHALL show, for a budget, the derived balance broken into its components — total,
adjustments, transfers in/out, reserved, actual, released, and the resulting available — each
formatted to the currency's decimal places. The breakdown SHALL be the derived figures, never
a stored usage value on the budget.

#### Scenario: Breakdown explains the available balance

- **WHEN** the user opens a budget's detail
- **THEN** the components are shown and reconcile to the available balance

### Requirement: Budget Ledger View

The web app SHALL show a budget's append-only ledger entries (transaction type, amount, source
document, remark, timestamp), most recent first, as a read-only history. Entries linked to a
source document SHALL link through to it.

#### Scenario: Ledger shows the transactions behind the balance

- **WHEN** the user views a budget that has had a reservation settled
- **THEN** the RESERVE / ACTUAL / RELEASE entries are listed with their amounts

### Requirement: Permission-Gated Budget Affordances

The budgets navigation, list, and detail SHALL be shown only to users holding `BUDGET_VIEW`
(UX only; the server still enforces).

#### Scenario: Budgets hidden without permission

- **WHEN** a user without `BUDGET_VIEW` is signed in
- **THEN** the Budgets navigation entry is not shown
