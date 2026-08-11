## ADDED Requirements

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

## MODIFIED Requirements

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
