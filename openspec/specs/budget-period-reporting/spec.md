# budget-period-reporting Specification

## Purpose
TBD - created by archiving change see-spending-by-quarter. Update Purpose after archive.
## Requirements
### Requirement: Consumption Read By Fiscal Quarter

The system SHALL expose a read that returns, for a fiscal year of the active company, the budget
consumption of each of its four quarters, grouped by department and resolvable to the individual
budgets beneath.

Consumption for a quarter SHALL be `Σ RESERVE − Σ RELEASE` of the budget transactions attributed to
it — the same definition the annual utilization read uses, so the two can never disagree — and
SHALL be derived from `budget_txn.txn_date`, which every ledger row already carries. The read SHALL
NOT require a new column on `budget_txn`.

The read SHALL be authorized by the same permission code as the other budget reports and SHALL be
scoped to the active company through the budget's fiscal year (invariant 1).

#### Scenario: Each quarter reports what it consumed

- **GIVEN** a budget reserved against in January and again in May
- **WHEN** the quarterly read runs for that fiscal year
- **THEN** Q1 reports the January amount, Q2 the May amount, and Q3 and Q4 report zero

#### Scenario: The four quarters sum to the annual figure

- **WHEN** the quarterly read and the annual utilization read run over the same fiscal year
- **THEN** the sum of the four quarters equals the annual consumed figure for every department

#### Scenario: Another company's budgets never appear

- **WHEN** the read runs in company A
- **THEN** no budget belonging to another company contributes to any quarter

### Requirement: A Release Is Counted In The Quarter That Committed It

A `RELEASE` SHALL be attributed to the quarter of the `RESERVE` it gives back, not to the quarter
its own `txn_date` falls in. The reserve is reachable because there is exactly one `RESERVE` per
`(document_id, budget_id)`.

A quarter's consumption therefore SHALL NOT be negative, and a quarter already reported MAY change
when a release lands in a later one. That is accepted: the figures are for internal use, and a
quarter that reports 100 when it really committed 70 is the worse error.

#### Scenario: A release returns to the quarter that committed it

- **GIVEN** a document that reserves 100,000,000 in Q2 and releases 30,000,000 in Q3
- **WHEN** the quarterly read runs
- **THEN** Q2 reports 70,000,000 and Q3 reports nothing from that document

#### Scenario: No quarter is ever negative

- **GIVEN** any set of reserves and releases across quarters
- **WHEN** the quarterly read runs
- **THEN** no quarter reports a consumption below zero

### Requirement: A Quarter Reports The Three Months Inside It

The quarterly read SHALL report, for each quarter of each budget and each department, the
consumption of each of the three months that quarter contains.

A month SHALL be identified by its position within the fiscal year, derived from
`fiscal_year.start_date`, never from the calendar month of `budget_txn.txn_date` — a fiscal year
that does not begin in January would otherwise place a row in a month belonging to another quarter.

The three monthly figures of a quarter SHALL sum exactly to that quarter's consumption. A
`budget_txn` row of type `RELEASE` SHALL therefore be attributed to the MONTH of the `RESERVE` it
gives back, following the rule that already attributes it to that reserve's quarter; a month already
reported MAY change when a release lands in a later one, on the same terms already accepted for
quarters.

A monthly figure SHALL be reported as an amount only. No comparison, percentage or label SHALL be
derived for a month.

The monthly figures SHALL be derived from the same single pass over the ledger that produces the
quarterly figures. The read SHALL NOT issue an additional query per month or per quarter.

#### Scenario: A quarter reports each of its months

- **GIVEN** a budget that consumed 10,000,000 in the first month of Q2 and 5,000,000 in the third
- **WHEN** the quarterly read runs
- **THEN** Q2 reports 10,000,000, 0 and 5,000,000 for its three months

#### Scenario: The three months sum to their quarter

- **GIVEN** any set of budget transactions in a fiscal year
- **WHEN** the quarterly read runs
- **THEN** for every quarter of every budget and every department, the three monthly figures sum to
  that quarter's consumption

#### Scenario: A release returns to the month that committed it

- **GIVEN** a document that reserves 100,000,000 in the first month of Q2 and releases 30,000,000 in
  the third
- **WHEN** the quarterly read runs
- **THEN** the first month of Q2 reports 70,000,000 and the third reports nothing from that document

#### Scenario: A fiscal year that does not start in January

- **GIVEN** a fiscal year starting on 1 April and a transaction dated in April
- **WHEN** the quarterly read runs
- **THEN** that transaction is reported in the first month of Q1

### Requirement: A Quarter Is Compared With The One Before It

Each quarter SHALL be reported with its change against the immediately preceding quarter. The
comparison SHALL NOT be drawn against a budget-derived pace line — neither the annual figure divided
by four nor any per-quarter allocation.

#### Scenario: A quarter reports its change against the previous one

- **GIVEN** Q1 consumed 100,000,000 and Q2 consumed 120,000,000
- **WHEN** the quarterly read runs
- **THEN** Q2 reports an increase of 20,000,000 against Q1

#### Scenario: No pace line is used

- **WHEN** a quarter is compared
- **THEN** the comparison uses only the previous quarter's consumption, and the budget's annual
  figure does not enter the calculation

### Requirement: An Unfinished Quarter Is Compared Over The Same Elapsed Window

A quarter that has not ended SHALL be reported with how much of it has elapsed, and its comparison
against the previous quarter SHALL cover the same number of elapsed days of that quarter rather
than the whole of it.

Elapsed time SHALL be measured against the company's day, not the server's — the same rule that put
`txn_date` on the ledger and that keeps the reports from deriving an overdue flag locally.

#### Scenario: A partial quarter is marked as partial

- **GIVEN** a quarter of 92 days of which 40 have passed
- **WHEN** the quarterly read runs
- **THEN** that quarter reports 40 of 92 days elapsed

#### Scenario: The comparison covers the same window

- **GIVEN** a current quarter 40 days old consuming 33,688,204,885, and a previous quarter that
  consumed 33,723,386,829 in its first 40 days and 90,365,434,887 in total
- **WHEN** the current quarter is compared
- **THEN** it is compared against 33,723,386,829, reporting a change of −0.1%, not against
  90,365,434,887, which would report −63%

#### Scenario: A finished quarter is compared whole

- **WHEN** both quarters have ended
- **THEN** the comparison uses the whole of each

### Requirement: A Comparison Without A Counterpart Is Labelled, Not Scored

When one side of a comparison consumed nothing, the read SHALL report which side is missing and
SHALL NOT emit a percentage change.

Fewer than 60% of this customer's budget lines have consumption in two consecutive quarters. Scoring
the rest would render 27–40% of them as `−100%` — correct and meaningless for an annual licence or
a once-a-year celebration — and the remainder as a division by zero.

Where NEITHER side consumed anything, the read SHALL report that there was no activity, and SHALL
NOT report the quarter as stopped. "Stopped" asserts that spending ran and ceased; a line that has
never been spent against has not stopped. This SHALL be distinct from a quarter the year has not
reached, which reports that it has not started: the calendar has arrived in one case and not in the
other, and the reader acts on them differently.

The rule SHALL be decided in ONE place, and departments SHALL be labelled by that same rule rather
than by a second copy of it.

#### Scenario: A line that started this quarter

- **GIVEN** a budget with no consumption in the previous quarter and consumption in this one
- **WHEN** it is compared
- **THEN** it is reported as newly started, with no percentage

#### Scenario: A line that stopped

- **GIVEN** a budget with consumption in the previous quarter and none in this one
- **WHEN** it is compared
- **THEN** it is reported as stopped, with no percentage

#### Scenario: A line that has never been spent against

- **GIVEN** a budget with no consumption in the previous quarter and none in this one, in a quarter
  the year has reached
- **WHEN** it is compared
- **THEN** it is reported as having no activity, with no percentage, and is NOT reported as stopped

#### Scenario: A quarter the year has not reached

- **GIVEN** a fiscal year still in its third quarter
- **WHEN** the fourth quarter is reported
- **THEN** it is reported as not started, with no percentage, and is not described as stopped and
  not described as having no activity

#### Scenario: A department is labelled the same way as the lines beneath it

- **GIVEN** a department whose budgets all report a quarter as not started
- **WHEN** that department's own figure for the quarter is reported
- **THEN** it carries the same label, and not a different one derived separately

#### Scenario: The first quarter of the earliest year

- **GIVEN** a fiscal year whose predecessor holds no ledger rows
- **WHEN** its first quarter is compared
- **THEN** it reports that there is no earlier quarter, and no percentage and no blank figure are
  emitted in place of one

### Requirement: A Budget Of Zero Is Reported As Overspent, Never As Unused

Where the quarterly view expresses consumption as a proportion of a budget, a budget of zero SHALL
report no proportion at all, and a zero budget that has been consumed against SHALL be reported as
overspent by the amount consumed.

A percentage of nothing does not exist, and zero is what every reader takes for untouched. This
matters immediately rather than in principle: 125 of the customer's plan codes carry spending
against no budget, 32,700,999,830 LAK between them.

#### Scenario: A zero budget with spending

- **GIVEN** a budget of zero consumed against by 75,000,000 in a quarter
- **WHEN** the quarterly read runs
- **THEN** that quarter reports 75,000,000 consumed and no proportion, and the row is marked
  overspent

#### Scenario: A zero budget with no spending

- **GIVEN** a budget of zero with no consumption
- **WHEN** the quarterly read runs
- **THEN** it reports no proportion, and is not marked overspent

### Requirement: A Quarter Reports Its Share Of The Annual Budget

Each quarter SHALL be reported with the share of the annual budget it consumed — its consumption
divided by `budget.amount_total`.

The denominator SHALL be the ANNUAL budget. There is no per-quarter budget in the system, and the
read SHALL NOT derive one.

Where the annual budget is zero the quarter SHALL report no share at all, under the rule already in
force for the year's share: a percentage of nothing does not exist, and zero is what every reader
takes for untouched.

#### Scenario: A quarter reports its share

- **GIVEN** a budget of 400,000,000 that consumed 100,000,000 in Q1
- **WHEN** the quarterly read runs
- **THEN** Q1 reports a share of 25% of the annual budget

#### Scenario: A quarter of a zero budget reports no share

- **GIVEN** a budget of zero consumed against by 75,000,000 in Q1
- **WHEN** the quarterly read runs
- **THEN** Q1 reports 75,000,000 consumed and no share, and the row is marked overspent

#### Scenario: The share is not drawn against a quarterly allocation

- **WHEN** a quarter's share is computed
- **THEN** the denominator is the annual figure, and no per-quarter budget figure enters the
  calculation

### Requirement: Every Row Reports What The Year Consumed And What Remains

Each budget line and each department SHALL be reported with its consumption for the fiscal year, the
amount of the annual budget remaining, and the remaining share.

The year's consumption SHALL equal the sum of its four quarters. The remaining amount SHALL be
`budget.amount_total` minus that consumption, and SHALL be reported as a negative amount where the
budget is overspent rather than floored at zero. The remaining share SHALL be reported only where a
year share exists, and SHALL be absent where the annual budget is zero.

#### Scenario: A row reports its year figures

- **GIVEN** a budget of 400,000,000 that consumed 100,000,000 across the year
- **WHEN** the quarterly read runs
- **THEN** it reports 100,000,000 consumed, 300,000,000 remaining, a 25% year share and a 75%
  remaining share

#### Scenario: An overspent row reports a negative remainder

- **GIVEN** a budget of 100,000,000 that consumed 150,000,000
- **WHEN** the quarterly read runs
- **THEN** it reports −50,000,000 remaining and is marked overspent

#### Scenario: A zero budget reports no remaining share

- **GIVEN** a budget of zero consumed against
- **WHEN** the quarterly read runs
- **THEN** it reports no year share and no remaining share

#### Scenario: A department carries the same figures as its lines

- **GIVEN** a department with two budget lines
- **WHEN** the quarterly read runs
- **THEN** the department's consumed and remaining amounts equal the sums of its lines', and its
  shares are computed by the same rule, not by a separately derived one

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

