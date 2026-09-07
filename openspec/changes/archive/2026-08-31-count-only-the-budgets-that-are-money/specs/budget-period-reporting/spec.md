## ADDED Requirements

### Requirement: The Report Counts Only Budgets That Are Or Were Money

Every figure this capability reports SHALL be computed over budgets whose `status` is `ACTIVE` or
`CLOSED`, and over no others. A budget in any other status SHALL NOT contribute to a quarter's
share, to the annual budget, to a department's rollup, or to a company total, and SHALL NOT appear
as a row.

`CLOSED` is counted because it is an appropriation that ran its year: it keeps its `amount_total`
and every ledger row, and a report on a closed year that excluded it would measure a year of
spending against a ceiling of zero and call every line overspent.

`DRAFT` is not counted: it is a proposal awaiting the approval that would put it in force, and it is
not spendable. `REJECTED` is not counted: it was refused and was never money. It is retained only
because `budget_movement.to_budget_id` references it and because the record of what was refused is
the point of routing budgets through approval — a record of a decision is not an appropriation.

The rule SHALL be expressed as the set of statuses that ARE counted, never as the set that are
excluded. A status absent from every declared list already exists in this system, so a rule written
as exclusions admits it silently — and being wrongly present in a ceiling is the defect this
requirement exists to end, while being wrongly absent is visible to anyone reading the report.

The status predicate SHALL narrow the company-scoped predicate and SHALL NOT replace it
(invariant 1).

The departments this report offers to be run for SHALL be derived by the same rule, so a department
holding only uncounted budgets is not offered a report with no money in it.

Where budgets have been left out, the read SHALL report how many and their combined `amount_total`,
and the screen SHALL state it. A total that silently shrinks between two openings is
indistinguishable from a total that broke.

#### Scenario: A refused proposal is not part of the annual budget

- **GIVEN** a department holding one `ACTIVE` budget of 12,000,000 and two `REJECTED` budgets of
  350,000,000 each
- **WHEN** the quarterly report is read for that department
- **THEN** its annual budget is 12,000,000, and neither refused proposal appears as a row

#### Scenario: A draft awaiting approval is not part of it either

- **GIVEN** a budget proposed by a plan that nobody has approved yet
- **WHEN** the report is read
- **THEN** that budget does not appear and does not raise the ceiling

#### Scenario: A closed year still reports what it was voted

- **GIVEN** a fiscal year whose budgets are `CLOSED`, with consumption recorded against them
- **WHEN** the report is read for that year
- **THEN** those budgets are counted, and their consumption is measured against their own annual
  budget rather than against zero

#### Scenario: A status in no declared list is not counted

- **GIVEN** a budget whose status is neither `ACTIVE` nor `CLOSED` nor any other declared value
- **WHEN** the report is read
- **THEN** that budget is excluded

#### Scenario: Consumption of the counted budgets is unchanged

- **GIVEN** a department whose counted budgets have ledger rows
- **WHEN** the report is read before and after uncounted budgets are excluded
- **THEN** every quarter's consumption figure for the counted budgets is identical

#### Scenario: A department holding nothing counted is not offered

- **GIVEN** a department whose only budgets are `REJECTED`
- **WHEN** the read returns the departments it can be run for
- **THEN** that department is not among them

#### Scenario: The report states what it excluded

- **GIVEN** a fiscal year holding budgets that are not counted
- **WHEN** the report is read
- **THEN** it reports how many budgets were excluded and their combined amount

#### Scenario: Nothing excluded is stated as nothing

- **GIVEN** a fiscal year whose every budget is `ACTIVE`
- **WHEN** the report is read
- **THEN** it reports no exclusions, and the screen says nothing about them
