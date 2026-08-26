## MODIFIED Requirements

### Requirement: Selectable Budgets for Document Creation

The system SHALL expose a read that returns the budgets a document creator may charge a line
to, authorized by the `DOC_CREATE` permission code (not `BUDGET_VIEW`). This read is how a line
gets its budget: the budget is named by the requester, never derived from the line's account.

The read SHALL return only selection fields for each budget — its `id`, its node's `code`, its
`budget_name`, its node's `parent_id`, and the `code` and `name` of that parent node — and SHALL NOT
return `amount_total`, any derived balance, breakdown component, or ledger row. It SHALL be scoped
to the active company via the budget's fiscal year / department (invariant 1) and SHALL return only
budgets whose `status` is `ACTIVE`. It SHALL be filterable by department, so a requester is offered
their own department's budgets rather than every budget in the company. This read is additive: the
existing amount-bearing budget reads (list, get, derived-balance, breakdown, ledger) remain
authorized by `BUDGET_VIEW` and unchanged.

The parent's `code` and `name` travel with the budget because `parent_id` alone cannot be resolved
by the caller. A budget's parent is usually a CATEGORY node, which holds no money and is therefore
never itself a selectable budget — so it never appears in this response. In the customer's largest
department 85 of 92 budgets have such a parent, leaving the client an identifier that matches
nothing it was given. The category is the only structure in the data that distinguishes budgets
whose own names differ by a single word, and a requester choosing among ninety of them needs it.

A category's `name` is a label, not a financial figure. Returning it SHALL NOT be read as weakening
the rule above: this read carries no money, and it is gated on `DOC_CREATE` rather than
`BUDGET_VIEW` so that a requester who may not read budget figures can still raise a document.

Where a budget's node has no parent, the parent fields SHALL be absent rather than empty strings, so
"has no category" stays distinguishable from "has a category with no name".

#### Scenario: Creator without BUDGET_VIEW can list selectable budgets

- **GIVEN** a user who holds `DOC_CREATE` but not `BUDGET_VIEW` in the active company
- **WHEN** the user requests the selectable-budgets read
- **THEN** the active company's `ACTIVE` budgets are returned with `id`, `code`, `budgetName`,
  `parentId` and the parent's `code` and `name` only, and the request is not rejected for lacking
  `BUDGET_VIEW`

#### Scenario: Selectable read exposes no financial figures

- **WHEN** any user requests the selectable-budgets read
- **THEN** the response contains no `amountTotal`, available balance, breakdown, or ledger data
  for any budget

#### Scenario: A budget under a category names that category

- **GIVEN** a budget whose node hangs off a category node that holds no budget of its own
- **WHEN** a user requests the selectable-budgets read
- **THEN** that budget carries the category node's `code` and `name`, even though the category is
  not itself returned as a selectable budget

#### Scenario: A budget with no parent carries no category

- **GIVEN** a budget whose node has no parent
- **WHEN** a user requests the selectable-budgets read
- **THEN** the parent fields are absent from that budget's entry

#### Scenario: Selectable read is company-scoped

- **WHEN** a user requests the selectable-budgets read while company A is active
- **THEN** only company A's budgets are returned and no budget belonging to another company
  appears

#### Scenario: Selectable read narrows to a department

- **WHEN** a user requests the selectable-budgets read for their own department
- **THEN** only that department's budgets are returned

#### Scenario: Inactive budgets are excluded

- **GIVEN** a budget in the active company whose `status` is not `ACTIVE`
- **WHEN** a user requests the selectable-budgets read
- **THEN** that budget is not returned
