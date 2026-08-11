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
the ceiling that will refuse it first. A budget governed by no control point SHALL be shown in a
group marked as a configuration fault rather than rendered as an ordinary ungoverned budget.

The group header SHALL show the control point's account node, department node, ceiling and
available, SHALL be visually distinct from a budget row, and SHALL NOT link to a budget detail or be
selectable wherever budgets are chosen — a control point holds no money of its own and cannot be
charged. Group figures SHALL come from the server's derived values for that control point and SHALL
NOT be summed in the browser, because a control point's available accounts for its whole governed
set including budgets outside the current page.

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

#### Scenario: The group header says its figures cover the whole group

- **GIVEN** a control point governing budgets that span more than one page of the list
- **WHEN** a page showing only some of them is displayed
- **THEN** the group header still reports the control point's whole-group ceiling and available
- **AND** the header states that those figures cover the entire group rather than the rows on this
  page

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

#### Scenario: Ledger shows the transactions behind the balance

- **WHEN** the user views a budget that has had a reservation settled
- **THEN** the RESERVE / ACTUAL / RELEASE entries are listed with their amounts

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

The web app SHALL let a user holding `BUDGET_MANAGE` create a budget by dimension and edit an
existing budget's editable attributes (UX only; the server remains authoritative and
company-scoped). Creation SHALL capture `fiscal_year`, `department`, `gl_account`,
`budget_name`, `amount_total`, and the control policy (`HARD_STOP` or `SOFT_WARNING`), and on
save SHALL call the create endpoint. Editing SHALL allow changing `budget_name`,
`control_policy`, and `status` only; the form SHALL NOT offer `amount_total` for edit, because
usage is derived and `budget.amount_total` is never overwritten (invariant: derived balances).
`amount_total` SHALL be handled as a string/Decimal (never a JS number), all labels SHALL come
from i18n with en/la parity, and the form SHALL use PrimeUI theme tokens so it renders in light
and dark mode.

#### Scenario: Create form hidden without BUDGET_MANAGE

- **WHEN** a user holding only `BUDGET_VIEW` opens the budgets list
- **THEN** the "New budget" action and the create route are not available to them

#### Scenario: Creating a budget by dimension

- **GIVEN** a user with `BUDGET_MANAGE`
- **WHEN** they choose a fiscal year, department, and GL account, enter an amount and a policy, and save
- **THEN** the budget is created via the create endpoint and the user is taken to its detail

#### Scenario: Edit does not expose amount_total

- **WHEN** a `BUDGET_MANAGE` user edits an existing budget
- **THEN** they can change name, policy, and status, but `amount_total` is not editable
- **AND** the page indicates that changing the budget figure is done through Adjust

#### Scenario: Invalid input is blocked before save

- **WHEN** a required dimension is missing, or `amount_total` is empty or not a positive number
- **THEN** the form shows a field error and does not call the server

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
