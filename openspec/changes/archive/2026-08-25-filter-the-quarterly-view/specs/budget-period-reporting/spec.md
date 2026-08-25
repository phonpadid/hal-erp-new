## ADDED Requirements

### Requirement: The Read Returns What It Could Be Run For

The quarterly read SHALL return, alongside its rows, the fiscal years of the active company it can
be run for, and every department the chosen fiscal year holds a budget for.

Both lists SHALL be resolved BEFORE any filter narrows the result, and SHALL therefore be unchanged
by the `fiscalYearId` and `departmentId` arguments in force. A list derived from the filtered rows
would collapse to the single department already chosen, stranding the reader with no way back.

The department list SHALL be reported separately from the report's rows. The rows are what the
current filters selected — one department when a department is chosen — and the two SHALL NOT share
a field.

Both lists SHALL be scoped to the active company (invariant 1). The read SHALL continue to make
exactly ONE pass over `budget_txn`; the lists SHALL NOT be obtained by scanning the ledger, and no
query SHALL be issued per quarter, per month or per filter.

The read exists in this shape because `/fiscal-years` is authorized for administrators, while this
report is authorized by the budget-reporting permission code (invariant 5). A reader who may run
the report SHALL NOT need an administrator's permission to discover which years they may run it
for.

#### Scenario: The lists survive a department filter

- **GIVEN** a fiscal year with budgets in five departments
- **WHEN** the read runs filtered to one department
- **THEN** it reports rows for that department alone, and still lists all five departments and
  every fiscal year the company has

#### Scenario: The lists survive a fiscal-year filter

- **WHEN** the read runs for a named fiscal year
- **THEN** it lists every fiscal year of the company, not only the one requested

#### Scenario: The departments are those of the year being reported

- **GIVEN** a company whose 2025 budgets and 2026 budgets sit in different departments
- **WHEN** the read runs for 2026
- **THEN** the department list holds 2026's departments, not 2025's

#### Scenario: Another company's years and departments never appear

- **WHEN** the read runs in company A
- **THEN** neither list contains a fiscal year or a department belonging to another company

#### Scenario: The ledger is still read once

- **WHEN** the read runs with both filters applied
- **THEN** it makes exactly one query against `budget_txn`, and issues no query per quarter, per
  month or per filter

## MODIFIED Requirements

### Requirement: The Quarterly Screen Opens At Department And Expands To Lines

The web app SHALL present the quarterly view grouped by department, with each department's budget
lines reachable beneath it, and SHALL show for each row the four quarters, the change against the
previous quarter, and the elapsed portion of any unfinished quarter.

Each quarter SHALL additionally show its share of the annual budget, and each row SHALL show what
the year consumed, what remains of the annual budget, the year's share and the remaining share.

The three monthly figures of a quarter SHALL be reachable on the screen, and SHALL NOT all be shown
by default: four quarters of three months alongside the quarter, share and year columns is a table
too wide to read. The monthly figures of a quarter SHALL be revealed for that quarter alone, leaving
the other three collapsed.

The screen SHALL offer a fiscal-year control and a department control, each of which SHALL re-run
the read on the server with that selection. Their options SHALL come from the lists the read
returns, so that a control remains usable after it has been used. Choosing a different fiscal year
SHALL clear the department selection, because a department is a property of that year's budgets and
may hold none in the year now chosen.

The screen SHALL additionally offer two narrowings of what is already loaded, which SHALL NOT
re-run the read because the response already answers them: a search over budget code and name, and
a control that shows only rows that have overspent. A department SHALL be kept when any budget line
beneath it matches the search, and a department whose own name matches SHALL keep the lines beneath
it.

Every figure the screen states, the summary tiles included, SHALL describe the rows currently
shown. A total that counts rows the table is not displaying contradicts the table beneath it.

When nothing is shown, the screen SHALL say WHICH emptiness it is: a fiscal year that holds no
budgets, and a narrowing that matched nothing, are different facts and send the reader to different
actions.

A quarter that cannot be compared SHALL be labelled in words rather than shown as a number, and a
row without a proportion SHALL NOT be drawn as an empty bar. Amounts SHALL be formatted from
strings using the company's base-currency decimal places, never from a JS number.

#### Scenario: The view opens at department level

- **WHEN** a user with the budget-reporting permission opens the quarterly view
- **THEN** it lists departments, and a department can be expanded to the budgets beneath it

#### Scenario: An unfinished quarter says so on screen

- **WHEN** the current quarter is displayed
- **THEN** it carries how much of it has elapsed, distinct from the finished quarters beside it

#### Scenario: A row that cannot be compared reads as words

- **WHEN** a row has no previous-quarter figure
- **THEN** the comparison cell reads that it started, stopped, has no activity, or has no earlier
  quarter — not `−100%`, not `∞`, and not an empty cell

#### Scenario: The months of one quarter are revealed alone

- **GIVEN** the quarterly view with every quarter collapsed
- **WHEN** the user reveals the months of the second quarter
- **THEN** that quarter shows its three monthly figures, and the other three quarters remain
  collapsed

#### Scenario: The year columns are shown for every row

- **WHEN** the quarterly view is displayed
- **THEN** every department and every budget line shows the year consumed, the remaining amount,
  the year's share and the remaining share, and a row with no share shows none rather than zero

#### Scenario: Choosing a department re-runs the read

- **WHEN** the user chooses a department
- **THEN** the read runs again with that department, and the screen shows the rows it returns

#### Scenario: A picker stays usable after it is used

- **GIVEN** the user has filtered to one department
- **WHEN** they open the department control again
- **THEN** every department of the fiscal year is still offered, not only the one in force

#### Scenario: Choosing a fiscal year clears the department

- **GIVEN** a department is selected
- **WHEN** the user chooses a different fiscal year
- **THEN** the department selection is cleared and the read runs for the whole of the new year

#### Scenario: Searching keeps the department of a matching line

- **GIVEN** a department whose name does not match `1.101` and which holds a budget line that does
- **WHEN** the user searches for `1.101`
- **THEN** that department is shown, with the matching line beneath it

#### Scenario: Searching does not re-run the read

- **WHEN** the user types in the search
- **THEN** no request is made, and the rows already loaded are narrowed in place

#### Scenario: Showing only overspent rows

- **WHEN** the user turns on the overspent-only control
- **THEN** only rows reported as overspent remain

#### Scenario: The tiles describe what is shown

- **GIVEN** a narrowing that removes rows from the table
- **WHEN** the summary tiles are read
- **THEN** their figures cover the rows still shown, and not the rows removed

#### Scenario: An empty match reads differently from an empty year

- **GIVEN** a fiscal year holding budgets
- **WHEN** a search matches nothing
- **THEN** the screen says the search matched nothing, and does not say the fiscal year holds no
  budgets
