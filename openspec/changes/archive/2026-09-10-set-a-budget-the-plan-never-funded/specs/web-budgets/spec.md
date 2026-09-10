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

`amount_total` SHALL accept zero. A plan line the organisation spends against but never funded is a
real line with a real figure, and that figure is nothing; the plan importer already writes `0` for
the section the workbook itself marks `ບໍ່ມີງົບ`, and a form that refuses what the importer writes
cannot be used to enter the same plan by hand. Empty, negative and non-numeric input SHALL still be
refused — a blank field is an unanswered question, not an answer of zero, and a negative
appropriation has no meaning.

Where zero is entered, the form SHALL say what it means before the user saves: the line is recorded
with no money, and spending against it will be refused until the tolerance ladder of the control
point governing it permits an overrun. Saying it here is what stops the officer from discovering it
as a refused document weeks later, on a screen that never mentioned a ladder.

The form SHALL place `gl_account` in the chain a document line resolves an account through — the
item's account, else the document type's default, else this — rather than stating that a budget
naming none cannot be charged. It MAY advise leaving the field empty when the budget's spending
posts to several accounts, because the lines then name their own.

This paragraph said the opposite until `debit-the-account-the-line-named`, and it was right while it
was true: the ledger read `budget.account_id` and nothing else, so a budget naming none stranded
every payment charged to it. The line now carries its own account, so a budget naming none is
charged perfectly well whenever the item or the document type names one, and a budget whose spending
genuinely spans several accounts no longer has to pick one of them falsely or be split in two.

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

#### Scenario: The form places the account in the chain rather than warning about a refusal

- **WHEN** a `BUDGET_MANAGE` user opens the create or edit form
- **THEN** the GL account field describes itself as the last step of the chain a line resolves
  through, and does not claim that a budget naming no account cannot be charged

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

- **WHEN** a required dimension is missing, no node is chosen, or `amount_total` is empty, negative
  or not a number
- **THEN** the form shows a field error and does not call the server

#### Scenario: A budget of zero is accepted

- **GIVEN** a `BUDGET_MANAGE` user proposing a plan line the organisation never funded
- **WHEN** they enter `0` as the amount and save
- **THEN** the form accepts it and one call proposes a budget whose `amount_total` is `0`

#### Scenario: Entering zero says what zero will do

- **WHEN** the amount entered is zero
- **THEN** the form states that the line is recorded with no money and that spending against it is
  refused until the governing control point's ladder permits an overrun

#### Scenario: A negative amount is still refused

- **WHEN** a `BUDGET_MANAGE` user enters a negative amount
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

### Requirement: Setting a Control Point's Tolerance Ladder

The web app SHALL let a user holding `BUDGET_MANAGE` edit the tolerance ladder of a
`budget_control_point` from the control point detail screen and from each row of the control point
list, and SHALL save it through the existing company-scoped update. A user holding only
`BUDGET_VIEW` SHALL continue to see the ladder and SHALL NOT be offered the editor.

The ladder is the only setting that decides whether spending past a ceiling is refused or recorded,
and it is the setting a budget officer most needs when a line is deliberately unfunded. Showing it
while refusing to change it sends work that is plainly theirs to whoever can call the API.

The editor SHALL let a rung be added, removed and changed — its threshold and its action — and SHALL
refuse to save a ladder with no rungs. An empty ladder checks nothing while reading as configured,
which is why the server refuses it; the client SHALL refuse it too rather than surfacing it as a
failed request.

Each action SHALL be labelled by what it does rather than by its code: `BLOCK` refuses the request
at that threshold, `WARN` allows it and records a warning. A threshold SHALL be entered as a
percentage of the ceiling and SHALL be refused when it is negative or not a number.

Where the ladder being saved would refuse every request the point governs — a `BLOCK` rung at or
below a ceiling of zero — the screen SHALL say so before the save, naming the consequence: no
document may charge these budgets, including one recording spending that already happened. It SHALL
NOT prevent the save: a deliberately frozen line is a legitimate configuration, and only the person
setting it knows which one this is.

The ladder SHALL be sent exactly as configured. The client SHALL NOT reorder, deduplicate or
normalise rungs on the way out: every matched rung applies and a matched `BLOCK` beats a matched
`WARN`, so ordering carries no meaning and a client that rewrites the ladder makes the saved
configuration differ from the one that was reviewed.

All labels SHALL come from i18n with en/la/zh parity, thresholds and amounts SHALL be formatted to
the company base currency's `decimal_places` where they are amounts, and the editor SHALL use
PrimeUI theme tokens so it renders in light and dark mode.

#### Scenario: The ladder editor is offered to a budget manager

- **GIVEN** a user holding `BUDGET_MANAGE`
- **WHEN** they open a control point's detail
- **THEN** the tolerance ladder is editable and can be saved

#### Scenario: The ladder is read-only without BUDGET_MANAGE

- **GIVEN** a user holding only `BUDGET_VIEW`
- **WHEN** they open a control point's detail
- **THEN** the ladder is shown and no edit affordance is offered

#### Scenario: A ladder can be changed from block to warn

- **GIVEN** a control point whose ladder is `BLOCK` at 100 percent
- **WHEN** a `BUDGET_MANAGE` user changes the rung's action to `WARN` and saves
- **THEN** the control point's ladder is `WARN` at 100 percent

#### Scenario: Rungs can be added and removed

- **GIVEN** a control point with one rung
- **WHEN** a `BUDGET_MANAGE` user adds a `WARN` rung at 90 percent and saves
- **THEN** the point has two rungs, and removing one and saving leaves one

#### Scenario: An empty ladder is refused before save

- **WHEN** a `BUDGET_MANAGE` user removes every rung and tries to save
- **THEN** the screen shows an error and does not call the server

#### Scenario: An invalid threshold is refused before save

- **WHEN** a threshold is left empty, is negative, or is not a number
- **THEN** the screen shows a field error and does not call the server

#### Scenario: A ladder that would refuse everything is called out

- **GIVEN** a control point whose governed budgets sum to zero
- **WHEN** a `BUDGET_MANAGE` user saves a ladder blocking at 100 percent
- **THEN** the screen states that no document may charge those budgets, including a backdated
  record of spending that already happened
- **AND** the save is still allowed

#### Scenario: Each action says what it does

- **WHEN** the editor is open
- **THEN** `BLOCK` is described as refusing at the threshold and `WARN` as allowing the overrun and
  recording a warning

#### Scenario: The ladder is sent as configured

- **GIVEN** a ladder entered as `BLOCK` at 100 then `WARN` at 90
- **WHEN** it is saved
- **THEN** the request carries the rungs in the order they were entered, unmodified

#### Scenario: The list offers the same edit per row

- **GIVEN** a `BUDGET_MANAGE` user on the control point list
- **WHEN** they edit a row's ladder and save
- **THEN** that control point's ladder is updated and the row reflects it without a full reload

#### Scenario: A refused save is surfaced, not swallowed

- **WHEN** the server refuses the ladder
- **THEN** the screen shows the server's message and leaves the editor open with the entered rungs
