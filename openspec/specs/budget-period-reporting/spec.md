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

#### Scenario: A line that started this quarter

- **GIVEN** a budget with no consumption in the previous quarter and consumption in this one
- **WHEN** it is compared
- **THEN** it is reported as newly started, with no percentage

#### Scenario: A line that stopped

- **GIVEN** a budget with consumption in the previous quarter and none in this one
- **WHEN** it is compared
- **THEN** it is reported as stopped, with no percentage

#### Scenario: A quarter the year has not reached

- **GIVEN** a fiscal year still in its third quarter
- **WHEN** the fourth quarter is reported
- **THEN** it is reported as not started, with no percentage, and is not described as stopped

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

### Requirement: The Quarterly Screen Opens At Department And Expands To Lines

The web app SHALL present the quarterly view grouped by department, with each department's budget
lines reachable beneath it, and SHALL show for each row the four quarters, the change against the
previous quarter, and the elapsed portion of any unfinished quarter.

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
- **THEN** the comparison cell reads that it started, stopped, or has no earlier quarter — not
  `−100%`, not `∞`, and not an empty cell

