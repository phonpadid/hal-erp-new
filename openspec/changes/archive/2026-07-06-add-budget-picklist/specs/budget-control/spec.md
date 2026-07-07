## ADDED Requirements

### Requirement: Selectable Budgets for Document Creation

The system SHALL expose a read that returns the budgets a document creator may charge a line
to, authorized by the `DOC_CREATE` permission code (not `BUDGET_VIEW`). The read SHALL return
only selection fields for each budget — its `id`, `budget_name`, and `gl_account` — and SHALL
NOT return `amount_total`, any derived balance, breakdown component, or ledger row. It SHALL be
scoped to the active company via the budget's fiscal year / department (invariant 1) and SHALL
return only budgets whose `status` is `ACTIVE`. This read is additive: the existing
amount-bearing budget reads (list, get, derived-balance, breakdown, ledger) remain authorized
by `BUDGET_VIEW` and unchanged.

#### Scenario: Creator without BUDGET_VIEW can list selectable budgets

- **GIVEN** a user who holds `DOC_CREATE` but not `BUDGET_VIEW` in the active company
- **WHEN** the user requests the selectable-budgets read
- **THEN** the active company's `ACTIVE` budgets are returned with `id`, `budgetName`, and
  `glAccount` only, and the request is not rejected for lacking `BUDGET_VIEW`

#### Scenario: Selectable read exposes no financial figures

- **WHEN** any user requests the selectable-budgets read
- **THEN** the response contains no `amountTotal`, available balance, breakdown, or ledger data
  for any budget

#### Scenario: Selectable read is company-scoped

- **WHEN** a user requests the selectable-budgets read while company A is active
- **THEN** only company A's budgets are returned and no budget belonging to another company
  appears

#### Scenario: Inactive budgets are excluded

- **GIVEN** a budget in the active company whose `status` is not `ACTIVE`
- **WHEN** a user requests the selectable-budgets read
- **THEN** that budget is not returned

#### Scenario: Selectable read requires DOC_CREATE

- **GIVEN** a user who holds neither `DOC_CREATE` nor `BUDGET_VIEW`
- **WHEN** the user requests the selectable-budgets read
- **THEN** the request is rejected as unauthorized
