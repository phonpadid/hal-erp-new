# web-budgets

## Purpose
The read-only Vue budget screens for end users: a company-scoped list of budgets showing each
budget's derived available balance, a per-budget balance breakdown that splits the derived
figures (total, adjustments, transfers, reserved, actual, released) and reconciles to the
available amount, and the append-only budget ledger presented as read-only history. All screens
display derived figures rather than any stored usage value, format money to the currency's
decimal places, and are gated by the `BUDGET_VIEW` permission code (client-side UX only; the
server remains authoritative and company-scoped).
## Requirements
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

A budget whose `status` is not `ACTIVE` SHALL NOT appear in that fault group, whatever that status
is. Each non-`ACTIVE` status is ungoverned for a reason of its own, and none of them is a defect:
`DRAFT` and `REJECTED` have never had coverage, because it is established at activation; `CLOSED`
had it and no longer needs it, because a ceiling on an appropriation nobody can draw from governs
nothing. Grouping any of them with a configuration fault would report a problem where the system is
working as specified.

They SHALL instead appear in their own group, one per status, labelled by that status and carrying
no ceiling or available figure because no control point governs them and none is owed. The grouping
SHALL be driven by the status value rather than by a list of known statuses, so a status added later
is bucketed correctly rather than falling into the fault group by omission.

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

### Requirement: Budget Balance Breakdown

The web app SHALL show, for a budget, the derived balance broken into its components — total,
adjustments, transfers in/out, reserved, actual, released, and the resulting available — each
formatted to the company base currency's `decimal_places`. The breakdown SHALL be the derived
figures, never a stored usage value on the budget, and amounts SHALL never be carried as a JS
number.

#### Scenario: Breakdown explains the available balance

- **WHEN** the user opens a budget's detail
- **THEN** the components are shown and reconcile to the available balance

#### Scenario: Breakdown amounts honor the currency decimal places

- **GIVEN** the company base currency has 3 decimal places
- **WHEN** the breakdown is shown
- **THEN** every component is formatted with 3 decimal places

### Requirement: Budget Ledger View

The web app SHALL show a budget's append-only ledger entries (transaction type, amount, source
document, remark, timestamp), most recent first, as a read-only history. Entries linked to a
source document SHALL link through to it. Amounts SHALL be formatted to the company base
currency's `decimal_places` and never carried as a JS number.

Each entry SHALL be presented in the direction it moves the available balance, and there SHALL be
three such directions, because the balance formula sorts the transaction types three ways: those
that add to the balance, those that subtract from it, and the settlement that changes it by nothing
at all. A settlement converts money an earlier reservation already removed from the available
balance into money recorded as spent; presenting it as a withdrawal charges the budget twice for one
document, which is the arithmetic invariant 3 forbids.

A settlement entry SHALL therefore carry no positive or negative sign and SHALL NOT reuse the visual
treatment given to entries that reduce the balance. It SHALL remain distinguishable from an entry
whose amount is absent or unknown: showing nothing where the other rows show a direction states that
the value is missing, when what is true is that the balance did not move.

The direction of each transaction type SHALL be derived from the same definition the balance
computation uses, rather than restated for display. A classification kept in two places is free to
disagree with itself, and the reader has no way to tell which copy is authoritative.

**The rendered ledger SHALL reconcile to the balance it explains.** Summing the entries in the
direction each is shown, over a budget's complete ledger, SHALL equal that budget's available
balance minus its appropriated total. This is the arithmetic a reader performs when checking a
history against a summary, and stating it makes the two halves of the screen answerable to each
other.

#### Scenario: Ledger shows the transactions behind the balance

- **WHEN** the user views a budget that has had a reservation settled
- **THEN** the RESERVE / ACTUAL / RELEASE entries are listed with their amounts

#### Scenario: A settled document is deducted once, not twice

- **GIVEN** a budget with one document that reserved an amount and was then settled for it in full
- **WHEN** the ledger is shown
- **THEN** the reservation is shown as reducing the balance and the settlement is not, so the two
  entries together account for the amount once

#### Scenario: The ledger reconciles to the available balance

- **GIVEN** a budget with reservations, settlements and releases in its history
- **WHEN** the entries are summed in the directions the ledger shows them
- **THEN** the total equals the available balance minus the appropriated total

#### Scenario: A settlement is legible as a settlement

- **WHEN** a settlement entry is shown
- **THEN** it carries no `+` or `−`, is not styled as an entry that reduces the balance, and remains
  distinguishable from an entry with no amount

#### Scenario: Ledger amounts honor the currency decimal places

- **WHEN** the ledger is shown for a budget whose base currency has 0 decimal places
- **THEN** each entry amount is formatted with 0 decimal places

### Requirement: Permission-Gated Budget Affordances

The budgets navigation, list, and detail SHALL be shown only to users holding `BUDGET_VIEW`
(UX only; the server still enforces).

#### Scenario: Budgets hidden without permission

- **WHEN** a user without `BUDGET_VIEW` is signed in
- **THEN** the Budgets navigation entry is not shown

### Requirement: Budget Adjustment Affordance

The budget detail page SHALL offer an "Adjust" action, shown only to users holding `BUDGET_MANAGE`
(UX only; the server still enforces). Activating it SHALL open a dialog to choose the direction
(increase or decrease), enter an amount, and enter a reason. When the active company has more than
one configured document type for the chosen direction, the dialog SHALL present a required
document-type selector and SHALL send the chosen type with the create request; when the company
has zero or one type for that direction, the dialog SHALL NOT show a selector and SHALL behave as
before. On confirm, the client SHALL create an adjustment document for that budget and navigate the
user to the new document so it can be submitted for approval — the client SHALL NOT attempt to
change the balance directly. The amount SHALL be handled as a string/Decimal (never a JS number),
all labels SHALL come from i18n with en/la parity, and the dialog SHALL use PrimeUI theme tokens so
it renders correctly in light and dark mode.

#### Scenario: Adjust action hidden without BUDGET_MANAGE

- **WHEN** a user holding only `BUDGET_VIEW` opens a budget detail page
- **THEN** the Adjust action is not shown

#### Scenario: Creating an adjustment routes to its approvable document

- **GIVEN** a user with `BUDGET_MANAGE` on a budget detail page
- **WHEN** they choose increase, enter an amount and a reason, and confirm
- **THEN** an adjustment document is created and the user is taken to that document to submit it for approval
- **AND** the budget's displayed balance does not change until the document is fully approved

#### Scenario: Type selector appears only when the direction has multiple types

- **GIVEN** the active company has two increase types and one decrease type
- **WHEN** the user chooses the increase direction
- **THEN** the dialog shows a required document-type selector
- **WHEN** the user chooses the decrease direction
- **THEN** the dialog shows no selector and uses the single decrease type

#### Scenario: Invalid input is blocked before submit

- **WHEN** the amount is empty or not a valid positive number, the reason is empty, or a type
  selector is shown but no type is chosen
- **THEN** the dialog shows a field error and does not create a document

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

### Requirement: Budget Transfer Affordance

The budget screens SHALL offer a "Transfer" action shown only to users holding `BUDGET_MANAGE`
(UX only; the server still enforces). Activating it SHALL open a dialog to pick a source budget
and a destination budget in the same company and same fiscal year, display each budget's derived
available balance for guidance, and enter an amount and a reason. When the active company has more
than one configured transfer document type, the dialog SHALL present a required document-type
selector and SHALL send the chosen type with the create request; when the company has zero or one
transfer type, the dialog SHALL NOT show a selector and SHALL behave as before. On confirm, the
client SHALL create an approvable transfer document for that pair and navigate the user to the new
document so it can be submitted for approval — the client SHALL NOT move money or write the ledger
directly. The amount SHALL be handled as a string/Decimal (never a JS number), all labels SHALL
come from i18n with en/la parity, and the dialog SHALL use PrimeUI theme tokens.

#### Scenario: Transfer action hidden without BUDGET_MANAGE

- **WHEN** a user holding only `BUDGET_VIEW` views the budgets
- **THEN** the Transfer action is not shown

#### Scenario: Creating a transfer routes to its approvable document

- **GIVEN** a `BUDGET_MANAGE` user with two budgets in the same company and fiscal year
- **WHEN** they pick source and destination, enter an amount and a reason, and confirm
- **THEN** a transfer document is created and the user is taken to that document to submit it for approval
- **AND** neither budget's displayed balance changes until the document is fully approved

#### Scenario: Type selector appears only with multiple transfer types

- **GIVEN** the active company has two active transfer types
- **WHEN** the Transfer dialog is opened
- **THEN** it shows a required document-type selector and sends the chosen type on confirm

#### Scenario: Invalid transfer input is blocked before submit

- **WHEN** the source and destination are the same, the amount is empty or not a positive number,
  the reason is empty, or a type selector is shown but no type is chosen
- **THEN** the dialog shows a field error and does not create a document

### Requirement: Budget Balance Waterfall Chart

The web app SHALL present the derived budget balance breakdown — the same
components as the Budget Balance Breakdown (total, adjustments in/out, transfers
in/out, reserved, actual, released, and the resulting available) — as a
floating-bars waterfall chart on the budget detail screen, in addition to the
numeric breakdown. The chart SHALL be a presentational view of the already-derived
figures: it MUST NOT read or display any stored usage value on the budget, MUST
derive each floating bar from the breakdown figures in the order total +
adjustIncrease − adjustDecrease + transferIn − transferOut − reserved + released,
and MUST reconcile to the same available balance as the numeric
breakdown. `actual` MUST NOT be charted as a movement: it draws down the reservation
rather than deducting again (the un-released reserve is the spend), so a bar for it
would double-count the document. It SHALL instead be surfaced as an informational
figure alongside the breakdown. Each bar SHALL float between the prior running balance and the new
running balance; the final available bar SHALL be grounded at zero as the result.
Increasing and decreasing movements SHALL be visually distinguished using PrimeUI
theme tokens (no hardcoded colors, so light and dark mode both render correctly).
All amounts in axis ticks and tooltips SHALL be formatted to the company base
currency's `decimal_places`, and SHALL NOT be carried as a JS number on the wire;
numeric values are parsed from the DECIMAL strings only to compute chart geometry.
The chart SHALL be gated by the `BUDGET_VIEW` permission and the active-company
context (client-side UX only; the server remains authoritative and
company-scoped).

#### Scenario: Waterfall shows how the budget travelled to available

- **GIVEN** a budget with amountTotal 1,000,000 and no movements
- **WHEN** a `BUDGET_VIEW` user opens the budget detail
- **THEN** the waterfall renders a starting bar at the total and a final available bar equal to 1,000,000
- **AND** the final available bar equals the numeric breakdown's available balance

#### Scenario: Each movement is a floating step that reconciles to available

- **GIVEN** a budget with amountTotal 1,000,000, reserved 100,000, and released 40,000
- **WHEN** the waterfall is shown
- **THEN** the reserved step floats downward by 100,000 from the running balance and the released step floats upward by 40,000
- **AND** the final available bar equals 940,000, matching the numeric breakdown

#### Scenario: Increases and decreases are visually distinguished

- **GIVEN** a budget with both an adjustIncrease and a reserved amount
- **WHEN** the waterfall is shown
- **THEN** the increasing step and the decreasing step use distinct PrimeUI theme tokens
- **AND** no hardcoded color is used, so the chart is legible in both light and dark mode

#### Scenario: Chart amounts honor the currency decimal places

- **GIVEN** the company base currency has 0 decimal places
- **WHEN** the waterfall axis ticks and a step tooltip are shown
- **THEN** each amount is formatted with 0 decimal places, not a hardcoded 2
- **AND** no amount is carried as a JS number on the wire

#### Scenario: Chart is hidden without the view permission

- **GIVEN** a user without the `BUDGET_VIEW` permission for the active company
- **WHEN** the budget detail screen is requested
- **THEN** the waterfall chart is not shown (and the server still does not return the budget)

### Requirement: Governing Control Points on the Budget Detail

The web app SHALL show, on a budget's detail, every active `budget_control_point` that
governs that budget, with each control point's account node, department node, and derived
available amount, formatted to the company base currency's `decimal_places` and never
carried as a JS number. A budget's own available balance is no longer the amount that decides
whether a document can be submitted against it; without seeing the governing control points a
user cannot tell why a line that appears to have room was refused, and the usual response to
an unexplained refusal is to charge the spend to a different line, which destroys the
reporting the budget exists to produce.

The panel SHALL be gated on `BUDGET_VIEW` like the other amount-bearing budget reads, and
SHALL be scoped to the active company.

#### Scenario: Governing control points are listed with their available amounts

- **GIVEN** a budget governed by a category control point and a department control point
- **WHEN** the user opens the budget's detail
- **THEN** both control points are listed with their account node, department node, and
  available amount

#### Scenario: The binding control point is distinguishable

- **GIVEN** a budget with 5,000,000 available governed by a control point with 10,000 available
- **WHEN** the user opens the budget's detail
- **THEN** the control point with the lowest available amount is identifiable as the one that
  will refuse first

#### Scenario: Control point amounts honor the currency decimal places

- **GIVEN** the company base currency has 3 decimal places
- **WHEN** the governing control points are shown
- **THEN** every available amount is formatted with 3 decimal places

#### Scenario: The panel is permission-gated

- **WHEN** a user without `BUDGET_VIEW` opens a budget detail they can otherwise reach
- **THEN** the governing control points panel is not shown

### Requirement: Over-Budget Refusal Names the Blocking Control Point

When a submission is refused with `BUDGET_EXCEEDED`, the web app SHALL surface the blocking
control point and its available amount as reported by the server, rather than only the budget
the user selected.

#### Scenario: The refusal message identifies the control point

- **GIVEN** a submission refused by a control point with 10,000 available
- **WHEN** the error is shown to the user
- **THEN** the message identifies that control point and its available amount of 10,000

### Requirement: Control Points List

The web app SHALL show a `BUDGET_VIEW` user the active company's `budget_control_point` rows, each
with its account node, department node, tolerance ladder, derived ceiling, used and available, and
the number of budgets it governs. Each row links to the control-point detail. The list SHALL NOT
show another company's control points, and every amount SHALL be formatted to the company base
currency's `decimal_places` and never carried as a JS number.

A control point is where spending is actually checked, and it has no `budget` row of its own — so
without this screen the only way to see a category's remaining ceiling is to open one of the budgets
beneath it and read the panel on that page.

#### Scenario: Lists the company's control points with their derived figures

- **WHEN** a `BUDGET_VIEW` user opens the control points list
- **THEN** each control point is shown with its account node, department node, ceiling and available

#### Scenario: Amounts honor the currency decimal places

- **GIVEN** the company base currency has 0 decimal places
- **WHEN** the control points list is shown
- **THEN** each amount is formatted with 0 decimal places, not a hardcoded 2

#### Scenario: The list is company-scoped

- **WHEN** a user opens the control points list while company A is active
- **THEN** no control point belonging to another company is shown

#### Scenario: The screen is permission-gated

- **WHEN** a user without `BUDGET_VIEW` attempts to reach the control points list
- **THEN** the route is not available to them

#### Scenario: Reachable from navigation

- **GIVEN** a user holding `BUDGET_VIEW`
- **WHEN** the sidebar is shown
- **THEN** a control points entry is present, labelled in the active locale

#### Scenario: Defaults to the current fiscal year

- **GIVEN** fiscal years 2025 and 2026, where 2026 covers today
- **WHEN** a `BUDGET_VIEW` user opens the control points list
- **THEN** only the 2026 control points are shown

#### Scenario: Falls back when no fiscal year covers today

- **GIVEN** no fiscal year covering today, and an open fiscal year 2026
- **WHEN** a `BUDGET_VIEW` user opens the control points list
- **THEN** the most recent open fiscal year's control points are shown, not every year's

### Requirement: Control Point Detail

The web app SHALL show, for one control point, its derived balance broken into the same components
as a budget breakdown — ceiling, adjustments, transfers, reserved, actual, released and the
resulting available — together with the tolerance ladder that governs it and the list of budgets it
governs, each with that budget's own derived available.

Showing the governed budgets alongside the group's available is the point of the screen: it is what
makes visible that a line can be far past its own amount while the group that governs it still
holds.

#### Scenario: Breakdown reconciles to the available amount

- **WHEN** a `BUDGET_VIEW` user opens a control point's detail
- **THEN** the components are shown and reconcile to its available amount

#### Scenario: Governed budgets are listed with their own available

- **GIVEN** a control point governing six budgets, one of which is 138,208,500 below its own amount
- **WHEN** the detail is opened
- **THEN** all six budgets are listed, and that budget shows its own negative available

#### Scenario: The tolerance ladder is shown

- **GIVEN** a control point with a ladder that warns at 90 percent and blocks at 100
- **WHEN** the detail is opened
- **THEN** both rungs are shown

#### Scenario: Amounts honor the currency decimal places

- **GIVEN** the company base currency has 0 decimal places
- **WHEN** the detail is shown
- **THEN** every amount is formatted with 0 decimal places

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

### Requirement: Group Utilisation Legible in Both Themes

The group header's utilisation fill SHALL remain distinguishable from its own track, and the
figures drawn over it SHALL remain legible, in both the light and dark themes. The fill's colour
SHALL be derived from the same theme token in both — no literal colour and no second palette — with
only its strength differing, because one strength cannot serve both: a light hue at low opacity
separates well from a dark row and blends into a light one.

The theme SHALL be read from the signal the application already uses for it (`darkModeSelector`),
not from a second source such as a media query, so an explicit user toggle and the rendering cannot
disagree.

#### Scenario: The fill is distinguishable from its track in light mode

- **GIVEN** the light theme is active
- **WHEN** a group header with a partly used ceiling is shown
- **THEN** its fill is visibly distinct from the unfilled part of its track

#### Scenario: The fill is distinguishable from its track in dark mode

- **GIVEN** the dark theme is active
- **WHEN** a group header with a partly used ceiling is shown
- **THEN** its fill is visibly distinct from the unfilled part of its track

#### Scenario: The figures stay legible over the fill in both themes

- **WHEN** a group header is shown in either theme
- **THEN** its percentage and amounts are rendered at full opacity over the fill

#### Scenario: The colour comes from a token, not a literal

- **WHEN** the fill is rendered in either theme
- **THEN** its colour is derived from a theme token rather than a hardcoded colour value

### Requirement: Flat or Grouped Budget List

The web app SHALL let a `BUDGET_VIEW` user switch the budget list between grouped and flat, with
grouped as the default. The choice SHALL persist for the session so a user scanning by name is not
re-grouped on every visit.

The toggle SHALL change presentation only: both modes render the same loaded rows and the same
server-derived figures, and flat mode omits the group headers rather than fetching anything
different. Grouping helps someone reading a category; it is in the way of someone looking for one
budget by name.

#### Scenario: Grouped is the default

- **WHEN** a `BUDGET_VIEW` user opens the budgets list for the first time in a session
- **THEN** the budgets are grouped under their governing control points

#### Scenario: Flat mode hides the group headers

- **WHEN** the user switches to flat
- **THEN** no group header is shown and every budget appears as an ordinary row

#### Scenario: Both modes show the same budgets and the same figures

- **WHEN** the user switches between grouped and flat
- **THEN** the same budgets are listed with the same derived available balances, and no additional
  request is issued

#### Scenario: The choice survives leaving and returning within the session

- **GIVEN** a user who has switched to flat
- **WHEN** they navigate away and return to the budgets list
- **THEN** the list is still flat

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

Every rolled-up MONEY figure the tree shows — a node's total and its available balance — SHALL be
computed over budgets whose `budget.status` is `ACTIVE` or `CLOSED`, and over no others. The count
of budgets beneath a node is not a money figure and SHALL keep counting all of them, because a
shared-budget mark reaches every budget at or beneath the node once it is in force. A budget in any other status SHALL contribute nothing to any ancestor's figure.
This is the same rule the `budget-period-reporting` capability states for every figure it reports,
and it SHALL be one declaration read by both, so that a report and the tree above it cannot state
different money. It SHALL be expressed as the set of statuses that ARE counted, never as the set
excluded: statuses outside every declared list are reachable in this system, and a deny-list would
admit them into a ceiling.

A budget that is not counted SHALL still appear in the tree, and SHALL be marked as not counted,
with its status named. It is not dropped: a `DRAFT` is a plan being written, a `REJECTED` is the
record of what a plan refused, and a tree that hid either would answer "what became of the budget I
proposed?" with silence. The mark SHALL use PrimeUI theme tokens so it reads in light and dark mode,
and SHALL carry a label from i18n at en/la/zh parity.

Where the tree renders a node holding exactly one budget and no child nodes AS that budget — one row
standing for both, because the plan line and the money at it are the same row in the reader's book —
that row SHALL follow the same rule: when its budget is not counted, the row is marked as not
counted and the node contributes nothing to its ancestors.

The tree SHALL let a `BUDGET_MANAGE` user mark a node as carrying shared budget, and SHALL show
which nodes are marked and which are shared because an ancestor is. This is the screen that already
renders the plan hierarchy, so it is the screen where a decision about a subtree can be seen before
it is made; the document form SHALL NOT offer it.

Before a node is marked, the screen SHALL make plain how much it covers — a mark on a department
root shares that whole department's money, while a mark on one category shares only that category.
The count of budgets beneath a node is already on this screen; the consequence of the mark SHALL be
visible at the moment of the decision rather than discovered afterwards from a picker offering more
than anyone intended.

#### Scenario: A budget shows its node's code

- **WHEN** a `BUDGET_VIEW` user opens the budgets list
- **THEN** each row shows the code of the node its money sits at, and its name

#### Scenario: The list can be shown as a tree

- **WHEN** the user switches the list to its tree presentation
- **THEN** budgets appear under their nodes, and a budget at a root node appears at the root

#### Scenario: A category shows the total beneath it

- **GIVEN** a category node with three `ACTIVE` budgets beneath it
- **WHEN** the tree presentation is shown
- **THEN** the category row shows the sum of those budgets' amounts

#### Scenario: A refused budget is not counted into its ancestors

- **GIVEN** a category node whose only budget is `REJECTED` for 30,000,000, left by a cancelled plan
- **WHEN** the tree presentation is shown
- **THEN** that category and every node above it show a total of zero

#### Scenario: A budget awaiting approval is not counted into its ancestors

- **GIVEN** a category node holding one `ACTIVE` budget of 12,000,000 and one `DRAFT` of 5,000,000
- **WHEN** the tree presentation is shown
- **THEN** the category row shows 12,000,000

#### Scenario: A closed budget is still counted

- **GIVEN** a category node holding one `CLOSED` budget
- **WHEN** the tree presentation is shown
- **THEN** that budget's amount is included in the category's total

#### Scenario: A status in no declared list is not counted

- **GIVEN** a budget whose status is neither `ACTIVE` nor `CLOSED` nor any other declared value
- **WHEN** the tree presentation is shown
- **THEN** it contributes nothing to any node's total

#### Scenario: An uncounted budget is shown rather than dropped

- **GIVEN** a node holding one `ACTIVE` budget and one `REJECTED` budget
- **WHEN** the tree presentation is shown
- **THEN** both rows are present, and the `REJECTED` row is marked as not counted with its status
  named

#### Scenario: A node standing for one uncounted budget is marked, not silently zeroed

- **GIVEN** a node with no child nodes whose single budget is `REJECTED`
- **WHEN** the tree presentation is shown
- **THEN** that row is marked as not counted, so its zero contribution is explained rather than read
  as a budget of nothing

#### Scenario: The reach of a mark still counts every budget beneath it

- **GIVEN** a node holding two `ACTIVE` budgets and three `DRAFT` budgets
- **WHEN** the screen states how many budgets a mark on that node would cover
- **THEN** it says five, because the mark shares the node itself and every budget at or beneath it
  once in force, while the node's money total shows only the two `ACTIVE` amounts

#### Scenario: A category is not mistaken for an allocation

- **WHEN** a category row is rendered
- **THEN** its figure is marked as a total of what lies beneath it rather than shown as though
  someone had allocated that amount to the category itself

#### Scenario: Amounts stay strings

- **WHEN** any budget amount or rolled-up total is rendered
- **THEN** it is formatted from a string/Decimal using the currency's decimal places, never from a
  JS number

#### Scenario: A node can be marked as shared from the tree

- **GIVEN** a `BUDGET_MANAGE` user viewing the tree presentation
- **WHEN** they mark a node as carrying shared budget
- **THEN** the node is marked, and the budgets beneath it are shared

#### Scenario: Inherited sharing is shown as inherited

- **GIVEN** a node whose ancestor is marked as shared
- **WHEN** the tree presentation is shown
- **THEN** that node is shown as shared through its ancestor, distinguishably from one marked itself

#### Scenario: Marking is not offered without BUDGET_MANAGE

- **WHEN** a user holding only `BUDGET_VIEW` views the tree presentation
- **THEN** no affordance to mark a node is offered to them

#### Scenario: The reach of a mark is visible before it is made

- **WHEN** a `BUDGET_MANAGE` user is about to mark a node
- **THEN** the screen states how many budgets the mark would cover

### Requirement: The Budget Form Says Where The Account Is Used, Not That It Is Required

The budget form SHALL describe `gl_account` as the last step of the account chain a document line
resolves through — used when the line names no item and its document type sets no default — and
SHALL NOT claim that a budget naming no account cannot be charged.

That claim was true for exactly as long as the ledger read `budget.account_id` and nothing else. A
line now carries its own account, so a budget naming none is charged perfectly well whenever the
item or the document type names one. A form that keeps warning about a refusal that no longer
happens teaches the reader to distrust its warnings.

All labels SHALL come from i18n with en/la parity, and the form SHALL use PrimeUI theme tokens so it
renders in light and dark mode.

#### Scenario: The hint places the account in the chain

- **WHEN** a `BUDGET_MANAGE` user opens the create or edit form
- **THEN** the GL account field says it applies to lines that name no item on a type with no
  default, and does not say the budget cannot be charged without it

#### Scenario: A budget still saves without an account

- **GIVEN** a budget whose spending posts to several accounts
- **WHEN** a `BUDGET_MANAGE` user saves it leaving the GL account empty
- **THEN** the form accepts it, and no warning claims documents cannot charge it
