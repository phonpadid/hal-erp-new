## ADDED Requirements

### Requirement: Resolve Budget by GL, Department, and Fiscal Year

The system SHALL expose a read that resolves the single `ACTIVE` budget for a given
`gl_account`, `department_id`, and fiscal year (identified by the document date), used
during document line creation to derive a line's `budget_id`. The read SHALL be authorized
by the `DOC_CREATE` permission code (not `BUDGET_VIEW`) and SHALL return only selection
fields — the budget's `id`, `budget_name`, and `gl_account` — never `amount_total`, a
derived balance, a breakdown component, or a ledger row. It SHALL be scoped to the active
company via the budget's fiscal year / department (invariant 1). It SHALL return no budget
when none is `ACTIVE` for the triple, so the caller can reject the line with a clear error.

#### Scenario: A unique active budget resolves

- **GIVEN** exactly one `ACTIVE` budget for fiscal year 2026, department D, and
  `gl_account` `5210` in the active company
- **WHEN** a `DOC_CREATE` user resolves a budget for that triple
- **THEN** that budget's `id`, `budgetName`, and `glAccount` are returned and no
  amount-bearing fields are included

#### Scenario: No active budget resolves to empty

- **GIVEN** no `ACTIVE` budget for the requested fiscal year, department, and `gl_account`
- **WHEN** a `DOC_CREATE` user resolves a budget for that triple
- **THEN** the read returns no budget, allowing the caller to reject the line

#### Scenario: Resolution is company-scoped

- **WHEN** a user resolves a budget while company A is active
- **THEN** only company A's budgets are considered and no other company's budget is
  returned

#### Scenario: Resolve requires DOC_CREATE

- **GIVEN** a user holding neither `DOC_CREATE` nor `BUDGET_VIEW`
- **WHEN** the user calls the resolve-budget read
- **THEN** the request is rejected as unauthorized
