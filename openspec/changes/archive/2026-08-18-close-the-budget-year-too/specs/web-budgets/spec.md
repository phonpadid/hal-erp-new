# web-budgets

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
