## MODIFIED Requirements

### Requirement: Budget Create and Edit

The web app SHALL let a user holding `BUDGET_MANAGE` propose a budget by dimension and edit an
existing budget's editable attributes (UX only; the server remains authoritative and
company-scoped). Proposing SHALL capture `fiscal_year`, `department`, the `budget_node` the money sits at,
`budget_name`, an optional `gl_account` and `amount_total`, and on save SHALL create a budget plan
carrying that line rather than a spendable budget. The node MAY be chosen from the existing tree or
created inline; a plan is usually written before its structure exists.

The node SHALL be required and SHALL be presented as the budget's identity — its `code` is what a
requester picks it by and what a department head says out loud — while `gl_account` SHALL remain
optional to save. The form SHALL NOT suggest that the account identifies the budget: several budgets
legitimately share one account.

The form SHALL state the consequence of leaving `gl_account` empty: a budget that names no account
cannot be charged by a document, because the ledger debits `budget.account_id` and a submit charging
a budget without one is refused. It SHALL NOT describe the field as a hint whose absence costs
nothing, and SHALL NOT advise leaving it empty when spending posts to several accounts — that advice
strands every payment charged to the budget, at the ledger, after the money has moved. A budget whose
spending genuinely spans several accounts is served today by naming one of them or by being split,
not by naming none.

A node's parent SHALL be selectable from nodes of the same fiscal year, and the form SHALL refuse a
parent that would make the node its own ancestor. The node carries no department — the department is
the budget's, not the plan line's, so one plan line can hold two departments' money and a control
point can still tell them apart.

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

Saving SHALL be one call to the server. The client SHALL NOT create the budget and then raise its
plan as two requests: a failure between them strands a budget the user cannot then delete, re-propose
or propose again.

The screen SHALL offer re-proposing a `DRAFT` budget that no plan carries, so a stranded row can be
recovered by the person looking at it.

Every list the form needs SHALL be authorized by `BUDGET_MANAGE`, the permission that authorizes
proposing. The form SHALL NOT source a required picker from a read that demands a permission the
proposer need not hold: the fiscal-year and department pickers came from the organisation
directory, which requires `FISCAL_YEAR_MANAGE` and `DEPARTMENT_VIEW`, and the budget officer who
held `BUDGET_MANAGE` held neither — so the screen built for them was the one screen they could not
use.

An affordance SHALL be offered only to a user whose permissions would allow the request behind it.
The inline "new fiscal year" and "new department" actions SHALL be shown only to a holder of the
organisation permission each one needs; creating a fiscal year is organisation administration, not
budget work, and a control that answers 403 is worse than no control.

Where the form cannot load what it needs, it SHALL say so rather than render. An unhandled failure
left every required picker empty with no message and no way forward, which is indistinguishable
from a form nobody has filled in yet.

#### Scenario: Create form hidden without BUDGET_MANAGE

- **WHEN** a user holding only `BUDGET_VIEW` opens the budgets list
- **THEN** the "New budget" action and the create route are not available to them

#### Scenario: Proposing a budget by dimension creates a plan

- **GIVEN** a user with `BUDGET_MANAGE`
- **WHEN** they choose a fiscal year, department and node, enter an amount, and save
- **THEN** a budget plan carrying that line is created and the user is taken to the plan document
- **AND** the budget is not spendable

#### Scenario: A budget can be proposed without a GL account

- **GIVEN** a budget whose account is not yet decided
- **WHEN** a `BUDGET_MANAGE` user saves it leaving the GL account empty
- **THEN** the form accepts it

#### Scenario: The form says what leaving the account empty costs

- **WHEN** a `BUDGET_MANAGE` user opens the create or edit form
- **THEN** the GL account field states that a budget naming no account cannot be charged by a
  document, and does not advise leaving it empty

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

#### Scenario: Saving is one request

- **WHEN** the user saves a proposed budget
- **THEN** one call is made, and a failure leaves no budget behind

#### Scenario: A stranded draft can be re-proposed from the screen

- **GIVEN** a `DRAFT` budget that no plan carries
- **WHEN** a `BUDGET_MANAGE` user opens it
- **THEN** the screen offers to propose it, and doing so takes them to the new plan document

#### Scenario: A budget officer can fill the form without organisation permissions

- **GIVEN** a user holding `BUDGET_MANAGE` and neither `FISCAL_YEAR_MANAGE` nor `DEPARTMENT_VIEW`
- **WHEN** they open the create form
- **THEN** the fiscal-year, department and node pickers are populated and the form can be submitted

#### Scenario: An organisation-creating action is offered only to whoever may perform it

- **GIVEN** a `BUDGET_MANAGE` user without `FISCAL_YEAR_MANAGE` or `DEPARTMENT_MANAGE`
- **WHEN** they open the create form
- **THEN** the inline "new fiscal year" and "new department" actions are not offered to them
- **AND** the inline "new plan node" action is, because creating a node requires `BUDGET_MANAGE`

#### Scenario: A form that cannot load says so

- **WHEN** a read the create form depends on fails
- **THEN** the screen shows an error state instead of a form with empty required pickers

## ADDED Requirements

### Requirement: The Budget List Shows Which Budgets Cannot Be Charged

The budget list SHALL mark a budget that names no GL account, so a `BUDGET_MANAGE` user can see
which of their budgets no document can charge without opening each one.

A budget with no account looks identical to a working one on every screen it appears on, including
the picker a requester chooses it from. The first sign of trouble is a refused submit belonging to
somebody else — which is too late and lands on the wrong person.

The mark SHALL use PrimeUI theme tokens so it reads in light and dark mode, and SHALL carry a
tooltip or label from i18n with en/la parity saying that documents cannot charge the budget until an
account is named.

#### Scenario: A budget with no account is marked

- **GIVEN** a company with one budget naming an account and one naming none
- **WHEN** a `BUDGET_MANAGE` user opens the budget list
- **THEN** the account-less budget is marked, and the mark says documents cannot charge it yet

#### Scenario: A budget that names an account carries no mark

- **WHEN** the list is shown
- **THEN** budgets naming an account are unmarked
