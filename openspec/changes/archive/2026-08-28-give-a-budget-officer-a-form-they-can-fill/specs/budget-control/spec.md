## ADDED Requirements

### Requirement: Proposing A Budget Needs Only The Permission That Proposes Budgets

The system SHALL offer the reads a budget proposal needs — the fiscal years a budget may be
proposed for, and the departments it may be proposed for — authorized by `BUDGET_MANAGE`, the same
permission that authorizes proposing. A holder of `BUDGET_MANAGE` SHALL be able to obtain every
value the proposal requires without holding any organisation-administration permission.

Both reads SHALL be scoped to the active company (invariant 1) and SHALL return identifying fields
only. A read that feeds a picker has no business carrying figures, and a list of names must not
become a side channel for what a budget or a company is worth.

The department read SHALL offer every active department of the active company, not only those that
already hold a budget. The existing filter read deliberately offers only budgeted departments,
because a filter must never present an option that yields nothing; a proposal needs the opposite,
since a department's FIRST budget is exactly what is being proposed.

Authorizing a read by the endpoint that happens to own it, rather than by the act it serves, is how
the budget officer was locked out of the form built for them: the pickers were fed from the
organisation directory, which requires `DEPARTMENT_VIEW` and `FISCAL_YEAR_MANAGE`, and the one user
holding `BUDGET_MANAGE` in the company held neither.

#### Scenario: A budget officer can read the fiscal years to propose against

- **GIVEN** a user holding `BUDGET_MANAGE` and neither `FISCAL_YEAR_MANAGE` nor `DEPARTMENT_VIEW`
- **WHEN** they request the fiscal years a budget may be proposed for
- **THEN** the active company's fiscal years are returned

#### Scenario: A budget officer can read the departments to propose for

- **GIVEN** the same user
- **WHEN** they request the departments a budget may be proposed for
- **THEN** the active company's active departments are returned

#### Scenario: A department holding no budget is still offered

- **GIVEN** an active department with no `budget` row of its own
- **WHEN** the departments a budget may be proposed for are read
- **THEN** that department is among them, so its first budget can be proposed

#### Scenario: Neither read crosses a company

- **GIVEN** a department and a fiscal year of another company
- **WHEN** either read is made in the active company
- **THEN** neither is returned (invariant 1)

#### Scenario: Neither read carries a figure

- **WHEN** either read is made
- **THEN** it returns identifying fields only, and no `amount_total`, balance or other monetary
  value

#### Scenario: Both reads are permission-gated

- **WHEN** a request without `BUDGET_MANAGE` is made to either read
- **THEN** it is rejected with 403 before the handler runs
