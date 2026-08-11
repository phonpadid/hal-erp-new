## ADDED Requirements

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
