## ADDED Requirements

### Requirement: The Annual Budget A Quarter Is Measured Against Is The Ledger's, Not The Column's

Wherever this capability speaks of the annual budget, it SHALL mean the budget as the ledger now
states it: `budget.amount_total` plus every `budget_txn` of type `ADJUST_INCREASE` and
`TRANSFER_IN`, minus every `budget_txn` of type `ADJUST_DECREASE` and `TRANSFER_OUT`, for that
budget. It SHALL NOT mean the `budget.amount_total` column alone.

`RESERVE`, `RELEASE` and `ACTUAL` SHALL NOT enter this figure. Those are consumption, which this
capability already measures separately as `Σ RESERVE − Σ RELEASE`; counting them in the ceiling as
well would net consumption against itself.

The direction each transaction type moves the balance SHALL come from the one shared
classification the rest of the system reads (`budgetTxnDirection`), never from a list restated in
the reporting module. Two independently written balance formulas are how the disagreement this
requirement exists to end came about, and a direction spelled out in a second place is that same
defect one step earlier.

The read SHALL fold this figure out of the ledger rows it already scans. It SHALL NOT issue a
second query over `budget_txn` for it: that scan runs over every document the company will ever
raise, and reading it twice to state one number is a cost this report cannot carry.

A test SHALL assert that what this read reports agrees with `BudgetBalanceService` for the same
budget, so sharing the classification is not left as an assumption.

#### Scenario: An adjusted budget reports the adjusted ceiling

- **GIVEN** a budget of 12,000,000 with approved adjustments of +65,004,000, +37,000,000,
  +1,000,000 and −3,000,000
- **WHEN** the quarterly read runs
- **THEN** the row's annual budget is 112,004,000, not 12,000,000

#### Scenario: Consumption does not raise or lower the ceiling

- **GIVEN** a budget of 100,000,000 that has reserved 40,000,000 and released 10,000,000
- **WHEN** the quarterly read runs
- **THEN** the row's annual budget is 100,000,000 and its year consumption is 30,000,000

#### Scenario: A transfer moves the ceiling on both sides

- **GIVEN** 5,000,000 transferred from one budget to another, both in the same fiscal year
- **WHEN** the quarterly read runs
- **THEN** the source row's annual budget is lower by 5,000,000 and the destination row's is higher
  by 5,000,000

### Requirement: The Quarterly Report And The Budget's Own Page State The Same Balance

For any budget, the remaining amount the quarterly read reports SHALL equal the balance CORE
INVARIANT 3 defines — `amount_total + ADJUST_INCREASE − ADJUST_DECREASE + TRANSFER_IN −
TRANSFER_OUT − RESERVE + RELEASE` — which is the figure the budget's own page reports.

This SHALL hold without a second calculation: the remaining amount is the ledger's annual budget
minus `Σ RESERVE − Σ RELEASE`, and those two terms together are that balance.

#### Scenario: The two screens agree on an adjusted, partly spent budget

- **GIVEN** a budget whose ledger holds an activation, adjustments in both directions, and
  reservations
- **WHEN** the quarterly read and the budget's detail read both run
- **THEN** the remaining amount of the quarterly row equals the balance the detail read reports

## MODIFIED Requirements

### Requirement: A Budget Of Zero Is Reported As Overspent, Never As Unused

Where the quarterly view expresses consumption as a proportion of a budget, a budget of zero SHALL
report no proportion at all, and a zero budget that has been consumed against SHALL be reported as
overspent by the amount consumed.

A budget is zero for this rule when its LEDGER figure is zero — the annual budget as defined by
"The Annual Budget A Quarter Is Measured Against Is The Ledger's, Not The Column's". A budget
raised at zero and since adjusted upwards is not a zero budget; a budget raised at an amount and
since adjusted back down to nothing is.

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

#### Scenario: A budget raised at zero and adjusted upwards is not a zero budget

- **GIVEN** a budget whose `amount_total` is zero and which carries an approved `ADJUST_INCREASE`
  of 20,000,000, consumed against by 5,000,000
- **WHEN** the quarterly read runs
- **THEN** it reports a 25% year share and is not marked overspent

### Requirement: A Quarter Reports Its Share Of The Annual Budget

Each quarter SHALL be reported with the share of the annual budget it consumed — its consumption
divided by the annual budget as the ledger states it.

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

#### Scenario: An adjustment moves the denominator

- **GIVEN** a budget of 100,000,000 that consumed 50,000,000 in Q1, then received an approved
  `ADJUST_INCREASE` of 100,000,000
- **WHEN** the quarterly read runs
- **THEN** Q1 reports a share of 25%, drawn against 200,000,000

### Requirement: Every Row Reports What The Year Consumed And What Remains

Each budget line and each department SHALL be reported with its consumption for the fiscal year, the
amount of the annual budget remaining, and the remaining share.

The year's consumption SHALL equal the sum of its four quarters. The remaining amount SHALL be the
annual budget as the ledger states it minus that consumption, and SHALL be reported as a negative
amount where the budget is overspent rather than floored at zero. The remaining share SHALL be
reported only where a year share exists, and SHALL be absent where the annual budget is zero.

A department's annual budget SHALL be the sum of its lines' ledger figures, computed the same way,
so that a department and the lines beneath it cannot state different money.

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

#### Scenario: An adjustment lifts a row out of overspend

- **GIVEN** a budget of 12,000,000 that consumed 112,004,000, and approved adjustments raising it
  to 112,004,000
- **WHEN** the quarterly read runs
- **THEN** it reports 0 remaining, a 100% year share, and is not marked overspent

### Requirement: The Quarterly Screen Opens At Department And Expands To Lines

The web app SHALL present the quarterly view grouped by department, with each department's budget
lines reachable beneath it, and SHALL show for each row the four quarters, the change against the
previous quarter, and the elapsed portion of any unfinished quarter.

Each quarter SHALL additionally show its share of the annual budget, and each row SHALL show what
the year consumed, what remains of the annual budget, the year's share and the remaining share.

The annual budget column SHALL be labelled as the budget as it now stands, not as the amount it was
raised at. A reader holding the original plan will otherwise read an adjusted figure as the report
being wrong.

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

#### Scenario: The annual column names what it is showing

- **WHEN** a budget that has been adjusted is displayed
- **THEN** the annual budget column reads as the budget as it now stands, and shows the adjusted
  figure
