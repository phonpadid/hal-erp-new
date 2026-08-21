## ADDED Requirements

### Requirement: The Budget Plan's Structure Is a Tree of Nodes, Not of Budgets

The system SHALL provide a `budget_node` record carrying a `company_id`, a `fiscal_year_id`, a
`code`, a name, and a nullable `parent_id` referencing another `budget_node`. It SHALL be unique per
`(fiscal_year_id, code)`. A `budget` SHALL reference exactly one node and SHALL carry its own
`department_id`; `gl_account` SHALL NOT participate in a budget's identity.

A node SHALL NOT carry a department. A control point names a node AND a department node, and the two
must be able to select independently; a node that fixed the department would leave the department
half able only to pass or fail as a whole, never to distinguish between budgets, and half of
coverage would be dead. Organisations whose codes happen to encode a department — as this one's do —
express that in their numbering, which is where it already lives.

The account cannot be a budget's identity because one account is charged by several budgets and one
budget posts to several accounts, in the same department and fiscal year. A key containing the
account can express neither.

A node SHALL NOT be a budget. The structure of a plan — department, category, line — and the money
appropriated at one of its lines are different things: a category has no amount, is charged by
nothing, is approved by no one on its own, and outlives no fiscal year. Modelling categories as
budgets that merely happen to hold no amount would put rows in the budget table that are not
budgets, and every reader of that table would then have to know which is which.

The `code` SHALL be the organisation's own vocabulary rather than a generated identifier, because it
is what a requester writes on a request and what a department head says out loud. `parent_id` — not
the code's shape — SHALL establish the hierarchy: a code is a string that can be mistyped, and in
this organisation's own codes `1.1` is a category while `1.101` is a line beneath it, both carrying
exactly one dot, so depth cannot be parsed from it at all. A cycle SHALL be rejected, and a parent MUST belong to the
same `fiscal_year_id` as its child, so a tree can never span a boundary the plan is itself scoped
by.

A node MAY have no budget hanging off it. An empty category is a plan being built, not a fault.

`budget.gl_account` SHALL become nullable and SHALL be read for one purpose only: stamping the
`gl_account` of a line that carries no item on a type that sets no `default_gl_account`. It SHALL
resolve nothing and identify nothing. A budget that posts to several accounts SHALL leave it null.

#### Scenario: Two budgets in one department share an account

- **GIVEN** a fiscal year and department in which budget `7.1 fuel` and budget `7.5 repairs` both
  post to account `658.0007`
- **WHEN** both are created
- **THEN** both exist, because the account is not part of either one's identity

#### Scenario: A duplicate code in the fiscal year is refused

- **GIVEN** an existing node with code `1.101` in a fiscal year
- **WHEN** another node with code `1.101` is created for the same fiscal year
- **THEN** the request is rejected

#### Scenario: The same code in another fiscal year is accepted

- **WHEN** a node with code `1.101` is created in a different fiscal year
- **THEN** it is created

#### Scenario: One node can hold two departments' money

- **GIVEN** a node `7.1 fuel` in a fiscal year
- **WHEN** two budgets are created at it, one for each of two departments
- **THEN** both exist, and a control point can still tell them apart by its department node

#### Scenario: A node names its parent

- **GIVEN** node `1.1` in a fiscal year
- **WHEN** node `1.101` is created with `parent_id` referencing `1.1`
- **THEN** it is created and `1.1` is its parent

#### Scenario: A parent in another fiscal year is refused

- **WHEN** a node is created whose `parent_id` references a node of a different fiscal year
- **THEN** the request is rejected

#### Scenario: A cycle is refused

- **WHEN** a node's `parent_id` is set so that the node becomes its own ancestor
- **THEN** the request is rejected

#### Scenario: A category holds no money and is charged by nothing

- **GIVEN** a node with child nodes beneath it
- **WHEN** the budgets of that fiscal year and department are listed
- **THEN** the category is not among them, because it is a node and not a budget

#### Scenario: A node may exist before any budget hangs off it

- **WHEN** a node is created and no budget references it
- **THEN** it is created, and no fault is reported

#### Scenario: A budget spanning several accounts records none

- **GIVEN** a budget for vehicle instalments, whose spending posts to a liability account and an
  expense account
- **WHEN** it is created with no `gl_account`
- **THEN** it is created

## MODIFIED Requirements

### Requirement: Budget Control Point

The system SHALL provide a `budget_control_point` record that declares WHERE budget
availability is checked, independently of WHERE budget amounts are posted. A control point
SHALL name a `company_id`, a `fiscal_year_id`, a `budget_node_id` referencing a `budget_node`
in the same company, a `department_node_id` referencing a `department` in the same company,
a nullable `cap_amount`, a `tolerance_json` ladder, and an `is_active` flag. It SHALL be
unique per `(company_id, fiscal_year_id, budget_node_id, department_node_id)`.

A `budget` SHALL be governed by every active control point in the same company and
`fiscal_year_id` whose `budget_node_id` is the budget's own node or an ancestor of it
via `budget_node.parent_id`, AND whose `department_node_id` is the budget's `department_id` or
an ancestor of it via `department.parent_dept_id`. A control point MAY be placed at any node,
leaf or otherwise: a control point is a checkpoint and not a posting target.

`cap_amount` SHALL be NULL in this capability's current form, and a request that sets it
SHALL be rejected. A NULL `cap_amount` means the control point's ceiling is the sum of
`budget.amount_total` over the budgets it governs. No caveat is needed about double counting: a
category is a node and holds no amount to count twice.

#### Scenario: A control point governs a budget through both trees

- **GIVEN** a budget at node `1.101` in department `D3`, whose node ancestors are `1.1` and `1`,
  and where `D3`'s ancestor is `D1`
- **WHEN** an active control point exists for budget node `1` and department node `D1` in the
  same company and fiscal year
- **THEN** that control point governs the budget

#### Scenario: A control point matching only one tree does not govern

- **GIVEN** a budget at node `1.101` in department `D3`
- **WHEN** an active control point exists for node `1` and a department node that is
  neither `D3` nor an ancestor of `D3`
- **THEN** that control point does not govern the budget

#### Scenario: A control point never governs across companies

- **GIVEN** a control point in company A and a budget in company B
- **WHEN** the governing control points of the company B budget are resolved
- **THEN** the company A control point is not among them

#### Scenario: A control point may sit on a leaf node

- **WHEN** a control point is created whose `budget_node_id` is a node with no children, carrying
  one budget
- **THEN** the control point is created and governs that budget alone

#### Scenario: A control point may sit on a category

- **WHEN** a control point is created whose `budget_node_id` is a node with children
- **THEN** the control point is created and governs every budget beneath it

#### Scenario: A control point over an empty category reports zero, never unlimited

- **GIVEN** a control point on a node beneath which no budget yet hangs
- **WHEN** its ceiling is derived
- **THEN** it is zero, so an empty category cannot become a ceiling nothing can exceed

#### Scenario: A non-null cap amount is rejected

- **WHEN** a control point is created or updated with a non-null `cap_amount`
- **THEN** the request is rejected with a 400

### Requirement: Availability Is Checked at Governing Control Points

The system SHALL check budget availability at the governing control points of the budgets a
document charges, not at the `budget` rows themselves. Reserved amounts SHALL first be
grouped by `budget_id` as today, then summed up to each governing control point, so that a
document charging several budgets governed by the same control point is checked once against
their combined amount. Every governing control point SHALL be checked; passing the most
specific one SHALL NOT exempt a submission from a wider one. Posting SHALL remain unchanged:
`budget_txn` rows are written against the `budget_id` of each line's budget.

The available amount at a control point SHALL be derived, never stored on the control point:
it is the sum of `budget.amount_total` over the governed budgets, adjusted by that set's
`budget_txn` rows using the invariant-3 formula — plus ADJUST_INCREASE, minus ADJUST_DECREASE,
plus TRANSFER_IN, minus TRANSFER_OUT, minus RESERVE, plus RELEASE, with ACTUAL never
subtracted.

#### Scenario: Lines under one control point are checked against their total

- **GIVEN** a control point with 100,000 available governing budgets A, B and C
- **AND** each of A, B and C individually has more than 40,000 available
- **WHEN** a document with three lines of 40,000 charging A, B and C is submitted
- **THEN** the submission is refused, because 120,000 exceeds the control point's 100,000

#### Scenario: A wider control point still blocks when a narrower one passes

- **GIVEN** a budget governed by a category control point with 500,000 available and by a
  department control point with 10,000 available
- **WHEN** a document reserving 50,000 against that budget is submitted
- **THEN** the submission is refused by the department control point

#### Scenario: Posting still happens at the budget

- **GIVEN** a document with two lines charging two different budgets governed by one control
  point
- **WHEN** the document is submitted and passes the control point's check
- **THEN** one RESERVE is written against each `budget_id`, and none against the control point

#### Scenario: A single-budget control point behaves exactly as before

- **GIVEN** a control point whose node is a budget's own node and whose department node is that
  budget's own `department_id`, governing only that budget
- **WHEN** a document reserves against that budget
- **THEN** the accepted and refused amounts are identical to checking that budget row alone

### Requirement: Selectable Budgets for Document Creation

The system SHALL expose a read that returns the budgets a document creator may charge a line
to, authorized by the `DOC_CREATE` permission code (not `BUDGET_VIEW`). This read is how a line
gets its budget: the budget is named by the requester, never derived from the line's account.

The read SHALL return only selection fields for each budget — its `id`, its node's `code`, its
`budget_name`, and its node's `parent_id` — and SHALL NOT return `amount_total`, any derived balance, breakdown component, or
ledger row. It SHALL be scoped to the active company via the budget's fiscal year / department
(invariant 1) and SHALL return only budgets whose `status` is `ACTIVE`. It SHALL be filterable by
department, so a requester is offered their own department's budgets rather than every budget in the
company. This read is additive: the existing amount-bearing budget reads (list, get,
derived-balance, breakdown, ledger) remain authorized by `BUDGET_VIEW` and unchanged.

#### Scenario: Creator without BUDGET_VIEW can list selectable budgets

- **GIVEN** a user who holds `DOC_CREATE` but not `BUDGET_VIEW` in the active company
- **WHEN** the user requests the selectable-budgets read
- **THEN** the active company's `ACTIVE` budgets are returned with `id`, `code`, `budgetName` and
  `parentId` only, and the request is not rejected for lacking `BUDGET_VIEW`

#### Scenario: Selectable read exposes no financial figures

- **WHEN** any user requests the selectable-budgets read
- **THEN** the response contains no `amountTotal`, available balance, breakdown, or ledger data
  for any budget

#### Scenario: Selectable read is company-scoped

- **WHEN** a user requests the selectable-budgets read while company A is active
- **THEN** only company A's budgets are returned and no budget belonging to another company
  appears

#### Scenario: Selectable read narrows to a department

- **WHEN** a user requests the selectable-budgets read for their own department
- **THEN** only that department's budgets are returned

#### Scenario: Inactive budgets are excluded

- **GIVEN** a budget in the active company whose `status` is not `ACTIVE`
- **WHEN** a user requests the selectable-budgets read
- **THEN** that budget is not returned

#### Scenario: Selectable read requires DOC_CREATE

- **GIVEN** a user who holds neither `DOC_CREATE` nor `BUDGET_VIEW`
- **WHEN** the user requests the selectable-budgets read
- **THEN** the request is rejected as unauthorized

## REMOVED Requirements

### Requirement: Resolve Budget by GL, Department, and Fiscal Year

**Reason**: The read resolves a single `ACTIVE` budget from `(gl_account, department_id, fiscal
year)`, which presumes at most one budget per account per department. The customer's books hold
several — one account charged by fuel, repairs and registration budgets inside one department — so
the triple no longer identifies anything, and a read that returns "the" budget for an account would
have to pick one arbitrarily.

**Migration**: A line names its budget through `Selectable Budgets for Document Creation`, which is
already authorized by the same `DOC_CREATE` code and already returns the same class of selection
fields. Callers that resolved a budget from an account now send the `budgetId` the requester chose.
The account is still derived from the item, unchanged; only the budget stops being derived from it.
