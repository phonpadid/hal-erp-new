## ADDED Requirements

### Requirement: A Proposed Budget Shows Where Its Approval Stands

The budget detail SHALL, for a budget whose `status` is `DRAFT` or `REJECTED`, name the budget plan
that proposed it and link to that document, so the answer to "why can nothing be spent against
this" is on the screen rather than inferred from the absence of a control point. It SHALL NOT offer
Adjust or Transfer for such a budget: both act through `budget_txn`, and a budget that is not in
force has nothing to move.

All labels SHALL come from i18n with en/la parity and SHALL use PrimeUI theme tokens so the screen
renders in light and dark mode.

#### Scenario: A DRAFT budget names its plan

- **GIVEN** a budget whose `status` is `DRAFT`, proposed by a submitted plan
- **WHEN** a `BUDGET_VIEW` user opens its detail
- **THEN** the plan document is named and linked, with its approval state

#### Scenario: A budget not in force offers no money actions

- **GIVEN** a budget whose `status` is `DRAFT` or `REJECTED`
- **WHEN** a `BUDGET_MANAGE` user opens its detail
- **THEN** neither Adjust nor Transfer is offered

## MODIFIED Requirements

### Requirement: Budget List

The web app SHALL show a `BUDGET_VIEW` user the active company's budgets (name, GL account,
fiscal year, department, total, status) with the derived available balance per budget. Each
row links to the budget detail. The list SHALL NOT show budgets of other companies. All money
columns SHALL be formatted to the company base currency's `decimal_places` (never a hardcoded
number of decimals and never a JS number).

Budgets SHALL be grouped under the control point that governs them. A budget governed by more than
one control point SHALL appear exactly once, under the governing point with the least available —
the ceiling that will refuse it first. A budget whose `status` is `ACTIVE` and which is governed by
no control point SHALL be shown in a group marked as a configuration fault rather than rendered as
an ordinary ungoverned budget.

A budget whose `status` is not `ACTIVE` SHALL NOT appear in that fault group. `DRAFT` and `REJECTED`
budgets are ungoverned by design — coverage is established at activation — so grouping them with a
configuration fault would report a defect where the system is working as specified. They SHALL
instead appear in their own group, labelled by their status, carrying no ceiling or available
figure because no control point governs them and none is owed.

The group header SHALL show the control point's account node, department node, ceiling and
available, SHALL be visually distinct from a budget row, and SHALL NOT link to a budget detail or be
selectable wherever budgets are chosen — a control point holds no money of its own and cannot be
charged. Group figures SHALL come from the server's derived values for that control point and SHALL
NOT be summed in the browser, because a control point's available accounts for its whole governed
set including budgets outside the current page.

When the list is grouped, the row number SHALL restart at one within each group. A number that runs
through a heading it is not part of belongs to a flat list; in a grouped one it counts the rows the
heading introduces.

#### Scenario: Lists the company's budgets with available balance

- **WHEN** a `BUDGET_VIEW` user opens the budgets list
- **THEN** the active company's budgets are shown, each with its derived available balance

#### Scenario: Amounts honor the currency decimal places

- **GIVEN** the company base currency has 0 decimal places
- **WHEN** the budgets list is shown
- **THEN** each amount is formatted with 0 decimal places, not a hardcoded 2

#### Scenario: Budgets group under their governing control point

- **GIVEN** six budgets governed by one control point
- **WHEN** the budgets list is shown
- **THEN** the six appear beneath a single group header carrying that control point's ceiling and
  available

#### Scenario: A budget governed by several points appears once

- **GIVEN** a budget governed by a category point with 500,000 available and a department point with
  10,000 available
- **WHEN** the budgets list is shown
- **THEN** that budget appears exactly once, under the department point

#### Scenario: The group header is not a budget

- **WHEN** the budgets list is shown
- **THEN** the group header carries no status chip, does not link to a budget detail, and cannot be
  selected as a budget

#### Scenario: An ungoverned budget is flagged, not hidden

- **GIVEN** an `ACTIVE` budget that no control point governs
- **WHEN** the budgets list is shown
- **THEN** it appears in a group marked as a configuration fault

#### Scenario: A DRAFT budget is not reported as a configuration fault

- **GIVEN** a `DRAFT` budget awaiting approval on a plan
- **WHEN** the budgets list is shown grouped
- **THEN** it appears in a group labelled by its status, not in the configuration-fault group
- **AND** that group header carries no ceiling or available figure

#### Scenario: The group header says its figures cover the whole group

- **GIVEN** a control point governing budgets that span more than one page of the list
- **WHEN** a page showing only some of them is displayed
- **THEN** the group header still reports the control point's whole-group ceiling and available
- **AND** the header states that those figures cover the entire group rather than the rows on this
  page

#### Scenario: Row numbers restart in each group

- **GIVEN** a grouped list whose first group holds seven budgets
- **WHEN** the list is shown
- **THEN** the first group's rows are numbered one to seven and the next group's first row is
  numbered one, not eight

### Requirement: Budget Create and Edit

The web app SHALL let a user holding `BUDGET_MANAGE` propose a budget by dimension and edit an
existing budget's editable attributes (UX only; the server remains authoritative and
company-scoped). Proposing SHALL capture `fiscal_year`, `department`, `gl_account`,
`budget_name` and `amount_total`, and on save SHALL create a budget plan carrying that line rather
than a spendable budget. The screen SHALL make clear that saving proposes a budget for approval and
does not put it in force, and SHALL take the user to the plan document so they can submit it.
Editing SHALL allow changing `budget_name` and `status` only; the form SHALL NOT offer
`amount_total` for edit, because usage is derived and `budget.amount_total` is never overwritten
(invariant: derived balances). `amount_total` SHALL be handled as a string/Decimal (never a JS
number), all labels SHALL come from i18n with en/la parity, and the form SHALL use PrimeUI theme
tokens so it renders in light and dark mode.

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
- **WHEN** they choose a fiscal year, department, and GL account, enter an amount, and save
- **THEN** a budget plan carrying that line is created and the user is taken to the plan document
- **AND** the budget is not spendable

#### Scenario: The screen says saving proposes rather than sets

- **WHEN** a `BUDGET_MANAGE` user opens the create form
- **THEN** it states that saving submits the budget for approval and does not put it in force

#### Scenario: Edit does not expose amount_total

- **WHEN** a `BUDGET_MANAGE` user edits an existing budget
- **THEN** they can change name and status, but `amount_total` is not editable
- **AND** the page indicates that changing the budget figure is done through Adjust

#### Scenario: Invalid input is blocked before save

- **WHEN** a required dimension is missing, or `amount_total` is empty or not a positive number
- **THEN** the form shows a field error and does not call the server

#### Scenario: No over-limit policy or ladder is offered

- **WHEN** a `BUDGET_MANAGE` user opens the create or edit form
- **THEN** no over-limit policy field and no tolerance ladder field is shown, and saving sends
  neither
