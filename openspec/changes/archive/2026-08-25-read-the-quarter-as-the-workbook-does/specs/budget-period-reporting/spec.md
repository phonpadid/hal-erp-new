## ADDED Requirements

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

## MODIFIED Requirements

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
