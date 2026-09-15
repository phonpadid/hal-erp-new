## ADDED Requirements

### Requirement: The Item Master Reads Budgets Well Enough To Name One

The system SHALL offer the item registry a read of the budgets an item may be bound to: the `ACTIVE`
budgets of the active company's open fiscal year. Each row SHALL identify ONE budget well enough to
be named on its own — the plan code (`budget_node.code`, unique within a fiscal year), the budget's
name, the department that holds it, and its `gl_account`. Rows SHALL NOT be merged by `gl_account`:
one account carries many budgets, and a caller that cannot tell them apart cannot bind one.

The read SHALL be authorized by `MASTER_VIEW`, not `BUDGET_VIEW` — whoever maintains the item
registry names the budget an item belongs to and need not be able to read what any budget is worth —
and SHALL be scoped to the active company (invariant 1). It SHALL return identifying fields only: a
read that feeds a picker has no business carrying figures.

#### Scenario: Each budget is identified individually

- **GIVEN** four `ACTIVE` budgets of the open fiscal year whose `gl_account` is all `612.06`
- **WHEN** the item registry reads the budgets an item may be bound to
- **THEN** four rows are returned, each carrying its own plan code, budget name and department

#### Scenario: Read with the permission that maintains the registry

- **GIVEN** a user holding `MASTER_VIEW` and not `BUDGET_VIEW`
- **WHEN** they read the budgets an item may be bound to
- **THEN** the active company's budgets are returned, carrying no amounts

#### Scenario: Another company's budgets are never returned

- **GIVEN** budgets in companies A and B
- **WHEN** the read is made while company A is active
- **THEN** only company A's budgets are returned
