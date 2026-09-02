## MODIFIED Requirements

### Requirement: Budget Create and Edit

The web app SHALL let a user holding `BUDGET_MANAGE` create a budget by dimension and edit an
existing budget's editable attributes (UX only; the server remains authoritative and
company-scoped). Creation SHALL capture `fiscal_year`, `department`, `gl_account`,
`budget_name` and `amount_total`, and on save SHALL call the create endpoint. Editing SHALL allow
changing `budget_name` and `status` only; the form SHALL NOT offer `amount_total` for edit, because
usage is derived and `budget.amount_total` is never overwritten (invariant: derived balances).
`amount_total` SHALL be handled as a string/Decimal (never a JS number), all labels SHALL come
from i18n with en/la parity, and the form SHALL use PrimeUI theme tokens so it renders in light
and dark mode.

The form SHALL NOT offer an over-limit policy. How strictly spending is checked belongs to the
control point governing the budget, not to the budget: a picker here would edit a ceiling shared
with budgets the user is not looking at, from a screen that shows only one of them.

#### Scenario: Create form hidden without BUDGET_MANAGE

- **WHEN** a user holding only `BUDGET_VIEW` opens the budgets list
- **THEN** the "New budget" action and the create route are not available to them

#### Scenario: Creating a budget by dimension

- **GIVEN** a user with `BUDGET_MANAGE`
- **WHEN** they choose a fiscal year, department, and GL account, enter an amount, and save
- **THEN** the budget is created via the create endpoint and the user is taken to its detail

#### Scenario: Edit does not expose amount_total

- **WHEN** a `BUDGET_MANAGE` user edits an existing budget
- **THEN** they can change name and status, but `amount_total` is not editable
- **AND** the page indicates that changing the budget figure is done through Adjust

#### Scenario: Invalid input is blocked before save

- **WHEN** a required dimension is missing, or `amount_total` is empty or not a positive number
- **THEN** the form shows a field error and does not call the server

#### Scenario: No over-limit policy is offered

- **WHEN** a `BUDGET_MANAGE` user opens the create or edit form
- **THEN** no over-limit policy field is shown, and saving sends none
