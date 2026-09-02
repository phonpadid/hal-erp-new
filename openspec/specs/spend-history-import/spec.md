# spend-history-import Specification

## Purpose
Bringing an existing year's recorded expenditure into the budget ledger from the customer's own
monitoring worksheet — grouped by budget and month so the period dimension survives, detailed to one
line per spend row so the descriptions do, and landing on budgets that exist or are created at zero
to receive it.

## Requirements
### Requirement: Spend History Import Command

The system SHALL provide an operator-run command that reads a monitoring worksheet of recorded
expenditure and writes it into the budget ledger of one named company and fiscal year.

The command SHALL require the company and the fiscal year to be named explicitly, SHALL refuse to
run without either, and SHALL support a dry run that reports what a real run would do while opening
no write transaction.

#### Scenario: Company and fiscal year must both be named

- **WHEN** the command runs without a company, or without a fiscal year
- **THEN** it refuses and writes nothing

#### Scenario: A dry run writes nothing

- **WHEN** the command runs with the dry-run flag
- **THEN** the report is produced and no document, line or ledger row is created

#### Scenario: The dry run agrees with the run it previews

- **WHEN** a dry run and then a real run are made over the same workbook
- **THEN** the counts of documents, lines, ledger rows and created budgets agree

### Requirement: One Document Per Budget Per Month, Carrying The Spend Rows As Lines

The importer SHALL group spend rows by the budget they charge and the month they fall in, and SHALL
create one document for each group with one `document_line` per spend row.

Each line SHALL carry the row's own description and amount, so the record of what was bought
survives the grouping. A monthly grain SHALL be used rather than an annual one: a document carries a
single date, and grouping a year onto one date destroys the period dimension every period report
depends on.

#### Scenario: A month of spending on one budget becomes one document

- **GIVEN** three spend rows charging one budget within one month
- **WHEN** the import runs
- **THEN** one document exists for that budget and month, carrying three lines

#### Scenario: Every description survives

- **WHEN** the import completes
- **THEN** each spend row's description appears on the line created from it

#### Scenario: Two months of one budget do not share a document

- **GIVEN** spending on one budget in two different months
- **WHEN** the import runs
- **THEN** two documents exist, each dated in its own month

### Requirement: Each Imported Document Writes A Reserve And An Actual

For each document it creates, the importer SHALL write a `RESERVE` and an `ACTUAL` of the same
amount, both dated in the month the document covers, and SHALL write no `RELEASE`.

`ACTUAL` does not reduce a budget's available balance — it converts a reservation already taken out
(invariant 3). Writing it alone would leave the spending invisible in every balance; writing
`RESERVE` alone would leave the money committed and never received. The pair is what actually
happened.

#### Scenario: The budget falls by what was spent

- **GIVEN** a budget of 1,000,000 and an imported document for 250,000
- **WHEN** the import completes
- **THEN** the budget's available balance is 750,000

#### Scenario: Nothing is released

- **WHEN** the import completes
- **THEN** no `RELEASE` row exists among the rows it wrote

#### Scenario: Both rows sit in the month of their spending

- **GIVEN** an imported document covering March
- **WHEN** its ledger rows are read
- **THEN** both the `RESERVE` and the `ACTUAL` carry a March date

### Requirement: A Budget Of Zero Is Created Where Spending Has Nowhere To Land

The importer SHALL create a budget of `amount_total` zero, at the node the plan code names and in
the department that code belongs to, whenever a spend row charges a code that has no budget in the
target fiscal year — and SHALL charge the spending to it.

The importer SHALL report every budget it creates this way, with the amount charged to it. It SHALL
NOT create a budget for a plan node that has no spending.

Spending against a line the plan left unfunded is ordinary rather than exceptional for this
customer — 125 codes and 32,700,999,830 LAK, nearly a sixth of the year. Refusing them would leave
that money out of every figure the system states.

#### Scenario: Spending on an unbudgeted plan line

- **GIVEN** a plan node with no budget and 3,675,828,099 of spending charged to its code
- **WHEN** the import runs
- **THEN** a budget of zero exists at that node and reports 3,675,828,099 consumed and overspent

#### Scenario: A plan node with no spending gets no budget

- **WHEN** the import completes
- **THEN** no budget has been created for a node the worksheet never charges

### Requirement: Every Budget Created Is Governed By A Control Point

The importer SHALL ensure that each budget it creates is governed by an active
`budget_control_point`, minting one at that budget's node and department when no existing point
already governs it, and SHALL abandon the run rather than leave a created budget ungoverned.

An ACTIVE budget that no control point governs is not merely unchecked — it is refused: the
reservation path will not spend against a budget it cannot check. Leaving these 125 lines
ungoverned would hand the customer money they cannot spend and no explanation, and would break the
coverage invariant that every ACTIVE budget is governed by something.

#### Scenario: A budget created at zero can be governed and checked

- **WHEN** the import creates a budget for spending that had nowhere to land
- **THEN** at least one active control point governs that budget

#### Scenario: The run is abandoned rather than leaving money unchecked

- **GIVEN** a budget the import created that no control point ends up governing
- **WHEN** the run reaches its coverage check
- **THEN** it fails and the company holds no document, line or ledger row from that run

### Requirement: The Plan Code Decides The Budget

The importer SHALL take the budget from the plan code a spend row charges, and SHALL NOT take it
from the row's department column when the two disagree. The department column SHALL be recorded as
the document's department.

Which budget was consumed is what the code states. Who spent it is what the department column
states, and it is not a budget question — taking it as one would create budgets that appear in no
plan.

#### Scenario: A department spends against another department's line

- **GIVEN** a row whose department column reads `6` and whose plan code reads `18.101`
- **WHEN** the import runs
- **THEN** the budget at node `18.101` is charged, and no budget for `18.101` is created in
  department `6`

#### Scenario: A department column holding a plan code

- **GIVEN** a row whose department column and plan code both read `12.113`
- **WHEN** the import runs
- **THEN** the budget for `12.113` is charged once

### Requirement: A Re-run Changes Nothing

The importer SHALL record an external source on each document it creates, and SHALL reuse the
existing document rather than creating a second one when a run repeats. A second run over the same
worksheet SHALL create no document, no line and no ledger row.

A duplicated ledger row cannot be removed: `budget_txn` is append-only, and a double-charged budget
could only be answered with a compensating entry.

#### Scenario: The same workbook imported twice

- **GIVEN** a company whose spend history has been imported
- **WHEN** the same workbook is imported again
- **THEN** no document, line or ledger row is created, and every one is reported as unchanged

#### Scenario: A budget is never charged twice

- **WHEN** the same workbook is imported twice
- **THEN** each budget's consumed figure is the same after the second run as after the first

### Requirement: Rows That Cannot Be Read Are Reported, Never Guessed

The importer SHALL skip and report a spend row that carries no amount, no usable month, or no plan
code, and SHALL NOT infer a payment status from the worksheet's remark column.

A row skipped for want of a plan code SHALL be reported with its amount, because money the import
leaves out is what the operator has to account for.

#### Scenario: A row with no amount

- **GIVEN** a spend row whose converted amount is absent or zero
- **WHEN** the import runs
- **THEN** no line is created for it and the report names it

#### Scenario: A row that names no budget

- **GIVEN** a spend row carrying an amount and no plan code
- **WHEN** the import runs
- **THEN** no line is created for it, and the report names it with its amount

#### Scenario: No status is inferred

- **WHEN** the import runs
- **THEN** no document or line records whether the spending was paid, because the worksheet does not
  reliably say

### Requirement: All Or Nothing, Scoped To One Company

The importer SHALL write a run's documents, lines and ledger rows so that a failure part-way leaves
the company as it was, and every row it writes SHALL belong to the named company (invariant 1).

#### Scenario: A failure part-way writes nothing

- **GIVEN** a run that fails while writing ledger rows
- **WHEN** the failure is raised
- **THEN** the company holds no document, line or ledger row from that run

#### Scenario: Another company is untouched

- **WHEN** a history is imported for company A while company B exists
- **THEN** company B has no new document and no new ledger row

### Requirement: The Report Reconciles Against The Source

The importer SHALL report the totals it produced per quarter and per department, so that they can be
compared against the worksheet they came from before the figures are relied upon.

#### Scenario: Quarterly totals are reported

- **WHEN** the import runs, in dry run or for real
- **THEN** it reports the total it attributes to each quarter of the fiscal year

#### Scenario: Departments are reported

- **WHEN** the import runs
- **THEN** it reports, per department, the total charged to the budgets beneath it
