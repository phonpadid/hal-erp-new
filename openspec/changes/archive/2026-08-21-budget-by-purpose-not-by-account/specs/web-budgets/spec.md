## MODIFIED Requirements

### Requirement: Budget Create and Edit

The web app SHALL let a user holding `BUDGET_MANAGE` propose a budget by dimension and edit an
existing budget's editable attributes (UX only; the server remains authoritative and
company-scoped). Proposing SHALL capture `fiscal_year`, `department`, the `budget_node` the money sits at,
`budget_name`, an optional `gl_account` and `amount_total`, and on save SHALL create a budget plan
carrying that line rather than a spendable budget. The node MAY be chosen from the existing tree or
created inline; a plan is usually written before its structure exists.

The node SHALL be required and SHALL be presented as the budget's identity — its `code` is what a
requester picks it by and what a department head says out loud — while `gl_account` SHALL be
optional and presented as a hint used only to stamp a line that carries no item. The form SHALL NOT
suggest that the account identifies the budget: several budgets legitimately share one account, and
a budget whose spending posts to several accounts records none. A node's parent SHALL be selectable
from nodes of the same fiscal year, and the form SHALL refuse a parent that would make the node its
own ancestor. The node carries no department — the department is the budget's, not the plan line's,
so one plan line can hold two departments' money and a control point can still tell them apart.

The screen SHALL make clear that saving proposes a budget for approval and does not put it in force,
and SHALL take the user to the plan document so they can submit it. Editing SHALL allow changing
`budget_name`, `gl_account` and `status` only; the form SHALL NOT offer `amount_total` for edit,
because usage is derived and `budget.amount_total` is never overwritten (invariant: derived
balances). It SHALL NOT offer the node for edit once the budget exists, because the node is the
identity documents and history refer to it by. `amount_total` SHALL be handled as a string/Decimal
(never a JS number), all labels SHALL come from i18n with en/la parity, and the form SHALL use
PrimeUI theme tokens so it renders in light and dark mode.

The form SHALL NOT offer an over-limit policy or a tolerance ladder. How strictly spending is
checked belongs to the control point governing the budget, not to the budget: a picker here would
edit a ceiling shared with budgets the user is not looking at, from a screen that shows only one of
them — and at the moment this form is filled in, the control point that will govern the budget does
not exist yet.

#### Scenario: Create form hidden without BUDGET_MANAGE

- **WHEN** a user holding only `BUDGET_VIEW` opens the budgets list
- **THEN** the "New budget" action and the create route are not available to them

#### Scenario: Proposing a budget by dimension creates a plan

- **GIVEN** a user with `BUDGET_MANAGE`
- **WHEN** they choose a fiscal year, department and node, enter an amount, and save
- **THEN** a budget plan carrying that line is created and the user is taken to the plan document
- **AND** the budget is not spendable

#### Scenario: A budget can be proposed without a GL account

- **GIVEN** a budget whose spending will post to more than one account
- **WHEN** a `BUDGET_MANAGE` user saves it leaving the GL account empty
- **THEN** the form accepts it

#### Scenario: A duplicate node code in the fiscal year is refused before save

- **GIVEN** an existing node with code `1.101` in the chosen fiscal year
- **WHEN** the user creates another node with the same code inline and saves
- **THEN** the form shows a field error and the server rejection is surfaced against the code field

#### Scenario: A parent is chosen from the same fiscal year

- **WHEN** the user opens the parent selector
- **THEN** only nodes of the chosen fiscal year are offered

#### Scenario: The screen says saving proposes rather than sets

- **WHEN** a `BUDGET_MANAGE` user opens the create form
- **THEN** it states that saving submits the budget for approval and does not put it in force

#### Scenario: Edit does not expose amount_total or code

- **WHEN** a `BUDGET_MANAGE` user edits an existing budget
- **THEN** they can change name, GL account and status, but neither `amount_total` nor the node is
  editable
- **AND** the page indicates that changing the budget figure is done through Adjust

#### Scenario: Invalid input is blocked before save

- **WHEN** a required dimension is missing, no node is chosen, or `amount_total` is empty or not a
  positive number
- **THEN** the form shows a field error and does not call the server

#### Scenario: No over-limit policy or ladder is offered

- **WHEN** a `BUDGET_MANAGE` user opens the create or edit form
- **THEN** no over-limit policy field and no tolerance ladder field is shown, and saving sends
  neither

## ADDED Requirements

### Requirement: The Budget List Reads as a Tree

The budgets list SHALL show each budget's node `code` alongside its name, and SHALL be able to
present budgets under the tree their nodes describe — department, then category, then line — rather
than only as a flat table. A category row SHALL show the rolled-up total of the budgets beneath it,
so the figure a department head recognises from their own plan is on screen.

Their plan is authored as a tree and every control point will be placed on one of its nodes. A list
that shows only budgets gives an administrator no way to see the node they are about to govern, and
no way to check that a subtree sums to what they approved.

A category row SHALL be legible as structure rather than as an allocation: it is a node, it holds no
money of its own, and the figure against it is a total of what lies beneath.

#### Scenario: A budget shows its node's code

- **WHEN** a `BUDGET_VIEW` user opens the budgets list
- **THEN** each row shows the code of the node its money sits at, and its name

#### Scenario: The list can be shown as a tree

- **WHEN** the user switches the list to its tree presentation
- **THEN** budgets appear under their nodes, and a budget at a root node appears at the root

#### Scenario: A category shows the total beneath it

- **GIVEN** a category node with three budgets beneath it
- **WHEN** the tree presentation is shown
- **THEN** the category row shows the sum of those budgets' amounts

#### Scenario: A category is not mistaken for an allocation

- **WHEN** a category row is rendered
- **THEN** its figure is marked as a total of what lies beneath it rather than shown as though
  someone had allocated that amount to the category itself

#### Scenario: Amounts stay strings

- **WHEN** any budget amount or rolled-up total is rendered
- **THEN** it is formatted from a string/Decimal using the currency's decimal places, never from a
  JS number
