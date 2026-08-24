# budget-plan-import Specification

## Purpose
TBD - created by archiving change import-budget-plan. Update Purpose after archive.
## Requirements
### Requirement: Budget Plan Import Command

The system SHALL provide an operator-run command that reads an expenditure-plan worksheet and
creates, for one named company and fiscal year, the departments the plan names, the `budget_node`
rows describing its structure, and the `budget` rows holding its money.

The command SHALL require the company and the fiscal year to be named explicitly and SHALL refuse
to run without either. It SHALL support a dry run that reports what a real run would do and opens
no write transaction.

#### Scenario: Company and fiscal year must both be named

- **WHEN** the command is run without a company, or without a fiscal year
- **THEN** it refuses and writes nothing

#### Scenario: A dry run writes nothing

- **WHEN** the command is run with the dry-run flag
- **THEN** the report is produced and no department, node, budget or plan document is created

#### Scenario: The dry run agrees with the run it previews

- **WHEN** a dry run and then a real run are made over the same workbook
- **THEN** the counts the two report are the same

### Requirement: The Plan's Departments Are Created

The importer SHALL treat each plan code with no separator as a department, and SHALL create a
`department` for each one the company does not already have, taking the plan's code as `dept_code`
and the row's name as its name. It SHALL match an existing department by `dept_code` and SHALL
leave it unchanged, including its name.

A department the plan does not name SHALL NOT be altered.

#### Scenario: Missing departments are created from the plan's roots

- **GIVEN** a plan naming departments `1`–`20` and a company holding two of them
- **WHEN** the import runs
- **THEN** the eighteen absent departments are created and the two existing ones are untouched

#### Scenario: A second run creates no department

- **WHEN** the same plan is imported again
- **THEN** no department is created and none is renamed

### Requirement: Plan Departments Hang Beneath One Parent

The importer SHALL create the plan's departments beneath a single parent department, creating that
parent when the company does not already have it.

A plan document is approved by its routing department's workflow, and the system refuses a plan
line whose department falls outside that department's subtree. Departments created as unrelated
roots could therefore never be carried by one plan, and no control point could govern the company's
plan as a whole.

#### Scenario: Every plan department is created under the parent

- **WHEN** the import creates the departments the plan names
- **THEN** each has the parent department as its `parent_dept_id`

#### Scenario: A plan can be routed at the parent

- **GIVEN** budgets in two different plan departments
- **WHEN** a plan document routed at the parent department carries both
- **THEN** it is accepted

### Requirement: The Plan Document Type Is Enabled Where It Is Needed

The importer SHALL create the `dept_doc_type` mapping that the budget-plan document type needs for
each department it raises a plan against, reusing the company's existing published form template
and an active workflow.

The importer SHALL NOT create a workflow. When the company has no active workflow the run SHALL be
refused, naming what is missing: an approval route decides who may approve a budget, and an
importer must not decide that.

#### Scenario: A missing mapping is created

- **GIVEN** a department with no `dept_doc_type` for the budget-plan type
- **WHEN** the import runs
- **THEN** the mapping is created against the company's published template and an active workflow

#### Scenario: An existing mapping is reused

- **GIVEN** a department that already has one
- **WHEN** the import runs
- **THEN** it is used unchanged and no second mapping is created

#### Scenario: No workflow refuses the run

- **GIVEN** a company with no active workflow
- **WHEN** the import runs
- **THEN** it is refused naming the missing workflow, and nothing is created

### Requirement: Plan Structure Derived From Department And Code Tail

The importer SHALL read a plan code as `<department>.<tail>`, SHALL take the part before the
separator as the department, and SHALL set a row's parent to the row whose tail is the longest
proper prefix of this row's tail present in the plan, falling back to the department itself.

The importer SHALL NOT infer depth from a code's length, from the number of separators it carries,
or from any level column the worksheet provides.

#### Scenario: A department is never a child of another department

- **GIVEN** plan codes `1` and `10`
- **WHEN** the structure is derived
- **THEN** `10` is a department in its own right and is not placed beneath `1`

#### Scenario: The nearest existing shorter tail is the parent

- **GIVEN** codes `1.1`, `1.11` and `1.111`, and no code `1.10`
- **WHEN** the structure is derived
- **THEN** `1.111` is placed beneath `1.11`, and `1.101` would be placed beneath `1.1`

#### Scenario: A tail with no shorter match hangs off its department

- **WHEN** a row's tail has no proper prefix present in the plan
- **THEN** its parent is the department

### Requirement: Money Is Created Only Where It Is Not Already Counted

For each row carrying an annual amount, the importer SHALL create a `budget` at that row's node
when no row beneath it carries an amount. When a row's amount equals the sum of the amounts beneath
it, the importer SHALL create the node and SHALL NOT create a budget for it.

A budget MAY be created at a node that has children. The rule governs double counting, not depth:
a control point sums the `amount_total` of every budget in its subtree, so the same money appearing
at both a summary and its lines would raise that ceiling twice.

#### Scenario: A line with nothing beneath it holds its money

- **WHEN** a row carries an amount and no row beneath it carries one
- **THEN** a budget is created at its node for that amount

#### Scenario: A summary becomes structure only

- **GIVEN** a row stating exactly the total of the amounts beneath it
- **WHEN** the import runs
- **THEN** its node is created and no budget is created for it

#### Scenario: A ceiling counts a subtree's money once

- **GIVEN** a category stating the total of its three lines
- **WHEN** a control point governs that category after the import
- **THEN** its ceiling is that total, not twice it

### Requirement: The Unbudgeted Section Is Imported At Zero

The importer SHALL recognise that the plan divides into a budgeted section and an unbudgeted one,
and SHALL create every budget of the unbudgeted section with an `amount_total` of zero regardless
of the figure stated against it.

The worksheet states its own subtotals for the two sections. A figure in the annual column of an
unbudgeted row is not an appropriation: importing it as one would create spendable budget out of
rows their owner classified as having none, and no reader of the result would see anything wrong.

The structure of the unbudgeted section SHALL still be created — its departments, its nodes and a
zero budget at each holder — so that expenditure already incurred against it has somewhere true to
be recorded.

#### Scenario: An unbudgeted line gets a zero budget

- **GIVEN** a plan row in the unbudgeted section stating 3,588,000,000
- **WHEN** the import runs
- **THEN** a budget exists at its node with `amount_total` of zero

#### Scenario: Nothing can be spent against an unbudgeted line

- **GIVEN** an imported unbudgeted line and the control point governing it
- **WHEN** a document tries to reserve against it
- **THEN** the reservation is refused, because the ceiling is zero

#### Scenario: The budgeted section keeps its figures

- **WHEN** the import runs
- **THEN** every budget of the budgeted section carries the amount its row states

### Requirement: A Contradiction Is Reported, Never Resolved

The importer SHALL report, and never resolve, a row that carries an amount while the rows beneath
it carry amounts that do not sum to it: it SHALL create the row's node, SHALL NOT create a budget
for that row, and SHALL report the code, the amount it states, and the amount beneath it.

The importer SHALL NOT choose between the two figures. It SHALL also report, per department, the
department's own stated total beside the total of the budgets created beneath it.

#### Scenario: A conflicting row is imported as structure and named

- **GIVEN** a row stating 5,319,600,000 with 22,237,031,916 beneath it
- **WHEN** the import runs
- **THEN** its node exists, no budget carries its 5,319,600,000, and the report names the code with
  both figures

#### Scenario: Departments are reconciled in the report

- **WHEN** the import completes
- **THEN** the report shows, for every department, its stated annual total and the sum of the
  budgets created beneath it, so a difference is visible rather than implied

### Requirement: A Code Stated Twice Keeps Its First Statement

The importer SHALL keep the FIRST row of a plan code stated more than once, SHALL set the later
rows aside, and SHALL report every one of them with both the row kept and the row dropped.

The first row is an arbitrary winner chosen because it is stable: the same workbook imported again
yields the same plan. Refusing the whole run instead would hold 552 correct plan lines hostage to
one question about the spreadsheet, which helps nobody — the question is reported so it can be
answered, and the plan is imported meanwhile.

#### Scenario: Two rows share a code

- **GIVEN** two rows both coded `3.1`, one named `ຄ່າໂຄສະນາ` on row 162 and one named
  `ຄ່າໂປໂມຊັ້ນ` on row 175
- **WHEN** the import runs
- **THEN** the node takes the name and amount of row 162, and the report names both rows

#### Scenario: An identical restatement is not reported

- **GIVEN** a code stated twice with the same name and the same amount
- **WHEN** the import runs
- **THEN** nothing is reported about it

### Requirement: Imported Budgets Are Put In Force Through The Plan Path

The importer SHALL create budgets as `DRAFT` and SHALL put them in force by creating a budget plan
document per department and activating it through the same service the application uses, so that
control points are minted by the one code path that mints them.

The importer SHALL NOT create `ACTIVE` budgets directly and SHALL NOT create control points itself.

#### Scenario: Every imported budget ends up governed

- **WHEN** the import completes
- **THEN** every budget it created is `ACTIVE` and at least one control point governs it

#### Scenario: The import does not mint coverage of its own

- **WHEN** the import completes
- **THEN** every control point that exists was minted by activation, and the plan's coverage is the
  fewest points that cover it

### Requirement: All Or Nothing, Scoped To One Company

The importer SHALL write a run's departments, nodes, budgets and plan documents so that a failure
part-way leaves the company as it was. Every row it writes SHALL belong to the named company
(invariant: company isolation), and a run SHALL NOT write to any other company.

#### Scenario: A failure part-way writes nothing

- **GIVEN** a run that fails while activating a department's plan
- **WHEN** the failure is raised
- **THEN** the company holds no budget, node or department from that run

#### Scenario: Another company is untouched

- **WHEN** a plan is imported for company A while company B exists
- **THEN** company B has no new department, node or budget

