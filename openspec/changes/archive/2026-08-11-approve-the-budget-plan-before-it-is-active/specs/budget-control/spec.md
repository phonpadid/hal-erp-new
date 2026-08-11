## ADDED Requirements

### Requirement: Budget Plan Intake

A budget SHALL become spendable only through an approved document. The system SHALL let authorized
users (`BUDGET_MANAGE`) create a **budget plan**: a `document` whose `document_type.post_action` is
`ACTIVATE_BUDGET`, carrying one `budget_movement` row per proposed budget with `movement_type`
`ACTIVATE_BUDGET`, `to_budget_id` referencing a `DRAFT` `budget`, `amount` equal to that budget's
`amount_total`, and `reason` carrying the line's note. A plan MAY carry one or many lines; the
whole plan is approved or rejected as one.

The plan's `document_type` SHALL set `requires_budget` to `false`. A plan proposes budget, it does
not consume any, so submitting one SHALL take no reservation and write no `budget_txn`.

Intake SHALL follow the same rules the existing movement documents follow: the type is resolved by
`post_action` within the active company (invariant 7, never by type code), the type MUST be enabled
for the routing department via `dept_doc_type`, and the document number SHALL be issued through the
existing numbering service.

Every `budget` referenced by a plan MUST be `DRAFT` and MUST belong to the active company. A plan
SHALL be rejected when any of its lines references a budget that is already `ACTIVE`, already
`REJECTED`, or belongs to another company.

A plan SHALL name one routing `department`, and every line MUST target that department or one of
its descendants in the `department.parent_dept_id` tree. A plan is exactly as wide as the approvers
who sign it: `document.department_id` is what `dept_doc_type` resolves to a form and a workflow, so
a line outside the routing department's subtree would be approved by people with no authority over
it. A plan covering a whole company is expressed by routing it through the root department, not by
letting any plan reach any department.

#### Scenario: A plan is created as a document, not as spendable budget

- **GIVEN** a user with `BUDGET_MANAGE`
- **WHEN** they create a budget plan for a fiscal year with one proposed line
- **THEN** a `DRAFT` document is created with one `budget_movement` of `movement_type`
  `ACTIVATE_BUDGET` pointing at a `DRAFT` `budget`
- **AND** the budget cannot be spent against

#### Scenario: A plan carries many lines under one document

- **WHEN** a plan is created with proposed budgets for several departments in one fiscal year
- **THEN** one document is created carrying one `budget_movement` row per proposed budget

#### Scenario: Submitting a plan reserves nothing

- **GIVEN** a budget plan whose `document_type` has `requires_budget` `false`
- **WHEN** it is submitted
- **THEN** no `budget_txn` row is written and no budget is reserved

#### Scenario: A plan cannot reference an already-active budget

- **WHEN** a plan is created with a line referencing a budget whose `status` is `ACTIVE`
- **THEN** the request is rejected with a 400 naming that budget

#### Scenario: A line outside the routing department's subtree is rejected

- **GIVEN** a plan routed through a department
- **WHEN** one of its lines targets a department that is neither that department nor one of its
  descendants
- **THEN** the request is rejected with a 400 naming that department

#### Scenario: A line for a descendant department is accepted

- **GIVEN** a plan routed through a department that has child departments
- **WHEN** a line targets one of those children
- **THEN** the line is accepted

#### Scenario: Creating a plan is permission-gated

- **WHEN** a request without `BUDGET_MANAGE` tries to create a budget plan
- **THEN** it is rejected with 403 before the handler runs

### Requirement: Budget Plan Activation

On full approval of a plan the system SHALL activate every budget it carries, atomically. Within a
single transaction it SHALL set each referenced `budget.status` from `DRAFT` to `ACTIVE`, establish
control-point coverage for each of them, and verify that every one is governed by at least one
active `budget_control_point` before committing. If any line cannot be activated the whole
transaction SHALL roll back: a fiscal year SHALL NOT be left partly in force.

Activation SHALL write no `budget_txn` row. A budget's opening figure is `budget.amount_total`, not
a transaction (invariant 3), so bringing a budget into force moves no money.

Because a control point's ceiling is the sum of the budgets it governs, activation changes the
ceiling of every existing control point that will govern one of the plan's budgets. Activation
SHALL therefore lock those existing `budget_control_point` rows `FOR UPDATE` in ascending id
order — the same total order budget reservation uses — so that a plan activating concurrently with
spending documents serializes rather than deadlocks. Control points created during activation need
no lock, being invisible to other transactions until commit.

Activation SHALL create the fewest control points that cover the plan. A point created for one of
the plan's budgets also governs the plan's budgets below it in the account and department trees, so
a second, narrower point for those SHALL NOT be created: it would impose a ceiling nobody asked
for, on top of one that already checks them.

Activation SHALL process lines in a deterministic order — department tree depth, then `dept_code`,
then `gl_account` — so that activating the same plan content always yields the same control points.
Shallowest-first is what makes the created point land as high in the department tree as the plan
reaches, rather than depending on the order rows come back from the database.

A control point created during activation SHALL be scoped to the budget's own `account_id` and
`department_id` and SHALL block at its ceiling.

Activation SHALL be refused when the plan's `fiscal_year.status` is not `OPEN`. Bringing a budget
into force in a year the rest of the module treats as finished would create spendable budget for a
closed period. The check belongs at activation rather than at intake: drafting a plan for a year
that has not opened yet is legitimate, spending against it is not.

#### Scenario: Approving a plan activates every budget on it

- **GIVEN** an approved budget plan carrying three `DRAFT` budgets
- **WHEN** the post-action runs
- **THEN** all three budgets have `status` `ACTIVE` and each is governed by at least one active
  control point

#### Scenario: A plan that cannot be fully activated activates nothing

- **GIVEN** an approved budget plan whose activation fails on one line
- **WHEN** the post-action runs and its bounded retry is exhausted
- **THEN** no budget on the plan is `ACTIVE` and the terminal transition is rolled back

#### Scenario: Activation writes no ledger row

- **WHEN** a budget plan is activated
- **THEN** no `budget_txn` row is written for any budget on the plan

#### Scenario: Two lines needing the same control point create one

- **GIVEN** a plan with two lines whose budgets resolve to the same account node and department
  node in the same fiscal year
- **WHEN** the plan is activated
- **THEN** exactly one `budget_control_point` is created for them

#### Scenario: A line below another line's new control point gets no second one

- **GIVEN** a plan with one line for a department and another for a department below it, both on
  the same account
- **WHEN** the plan is activated
- **THEN** one control point is created, at the higher department
- **AND** both budgets are governed by it and by nothing else

#### Scenario: A control point created by activation blocks at its ceiling

- **WHEN** a plan is activated and one of its budgets is governed by nothing yet
- **THEN** a control point is created at that budget's own `account_id` and `department_id` whose
  tolerance ladder blocks at 100 percent

#### Scenario: A plan for a closed fiscal year does not activate

- **GIVEN** an approved budget plan whose `fiscal_year.status` is not `OPEN`
- **WHEN** the post-action runs
- **THEN** activation is refused, no budget on the plan becomes `ACTIVE`, and the terminal
  transition rolls back

#### Scenario: Activation serializes against concurrent reservation

- **GIVEN** a budget plan being activated and a document reserving against a budget governed by one
  of the same control points
- **WHEN** both run concurrently
- **THEN** both complete without deadlock and the reservation is decided against either the ceiling
  before activation or the ceiling after it, never a partly-activated plan

### Requirement: Budget Plan Rejection Frees the Proposed Lines

When a budget plan is rejected or cancelled, the system SHALL set every `budget` it references from
`DRAFT` to `REJECTED`. The rows SHALL NOT be deleted: `budget_movement.to_budget_id` references
them, and the record of what was proposed and turned down is the point of routing budgets through
approval at all.

No budget or quota is released, because a plan holds none.

#### Scenario: Rejecting a plan marks its budgets REJECTED

- **GIVEN** a submitted budget plan carrying two `DRAFT` budgets
- **WHEN** an approver rejects it
- **THEN** both budgets have `status` `REJECTED` and both rows still exist

#### Scenario: A rejected line can be proposed again

- **GIVEN** a rejected plan whose budget for a fiscal year, department and `gl_account` is
  `REJECTED`
- **WHEN** a new plan proposes a budget for the same fiscal year, department and `gl_account`
- **THEN** the new `DRAFT` budget is created successfully

#### Scenario: Rejecting a plan releases nothing

- **WHEN** a budget plan is rejected
- **THEN** no `budget_txn` release row is written

## MODIFIED Requirements

### Requirement: Budget Administration and Derived-Balance Query

The system SHALL let authorized users (`BUDGET_MANAGE`) create and maintain `budget`
rows and SHALL expose a read-only derived-balance query (`BUDGET_VIEW`).
`budget.amount_total` is set at creation and SHALL NOT be overwritten to reflect usage — available
balance is always computed from `budget_txn` (invariant 3). A budget's `gl_account` MUST reference
an active, postable `account` in the budget's company (resolved via the chart-of-accounts
resolver); the resolved account SHALL be recorded on `budget.account_id` alongside the
`gl_account` code. Creation SHALL be rejected when the `gl_account` does not resolve.

Creation SHALL produce a budget whose `status` is `DRAFT`. A `DRAFT` budget SHALL NOT be spendable
and SHALL NOT have a control point created for it: setting a ceiling is the largest financial
decision this module makes, and it SHALL take effect only through an approved budget plan. Coverage
is established at activation, not at creation.

A `budget` SHALL be unique per `fiscal_year` + `department` + `gl_account` **among rows whose
`status` is not `REJECTED`**. A `DRAFT` row therefore holds its dimension slot, which is what
prevents two plans proposing the same line concurrently; a `REJECTED` row releases it, so a line
that was turned down can be proposed again.

A budget SHALL NOT carry an over-limit policy of its own. How strictly spending is checked is
decided by the tolerance ladder on the governing control point, so expressing it twice would let
the two disagree with no rule for which wins.

Creation SHALL NOT carry a tolerance ladder. The ladder belongs to a control point that does not
exist until the plan is approved, and a proposed ladder held on the budget would be a value with no
meaning the moment it is used. A control point created at activation blocks at its ceiling, and
ladders are configured on the control point itself. A request carrying a tolerance ladder, or the
removed over-limit policy field, SHALL be rejected rather than have it ignored: a caller that
states how spending should be controlled and is silently overruled believes it configured something
it did not.

#### Scenario: Available balance is computed from the ledger

- **GIVEN** a budget with `amount_total` 1,000,000 and a RESERVE of 100,000
- **WHEN** the derived balance is queried
- **THEN** it returns 900,000 and `budget.amount_total` is still 1,000,000

#### Scenario: Creating a budget is permission-gated

- **WHEN** a request without `BUDGET_MANAGE` tries to create a budget
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: Budget GL account must resolve to an active postable account

- **WHEN** a budget is created with a `gl_account` that has no active, postable `account`
  in the company
- **THEN** the creation is rejected with a 400 naming the unknown code

#### Scenario: Valid GL account is recorded with its account id

- **WHEN** a budget is created with a `gl_account` that resolves to an active, postable
  account
- **THEN** the budget is stored with that `gl_account` code and its `account_id` set to the
  resolved account

#### Scenario: A created budget is DRAFT and governs nothing yet

- **WHEN** a budget is created
- **THEN** its `status` is `DRAFT`
- **AND** no `budget_control_point` is created for it

#### Scenario: A DRAFT budget holds its dimension slot

- **GIVEN** a `DRAFT` budget for a fiscal year, department and `gl_account`
- **WHEN** another budget is created for the same three dimensions
- **THEN** the creation is rejected

#### Scenario: A REJECTED budget does not hold its dimension slot

- **GIVEN** a `REJECTED` budget for a fiscal year, department and `gl_account`
- **WHEN** another budget is created for the same three dimensions
- **THEN** the creation succeeds

#### Scenario: The removed policy field is rejected, not ignored

- **WHEN** a budget is created or updated with the removed over-limit policy field
- **THEN** the request is rejected with a 400

#### Scenario: A tolerance ladder on creation is rejected, not ignored

- **WHEN** a budget is created with a tolerance ladder
- **THEN** the request is rejected with a 400

### Requirement: Every Active Budget Is Covered by a Control Point

Every `budget` whose `status` is `ACTIVE` MUST be governed by at least one active
`budget_control_point`. An uncovered budget would have no row to lock and no ceiling to
check, so its spending would be unlimited without any error being raised. The system SHALL
enforce coverage at budget **activation** and at control-point deactivation or deletion.

Budgets whose `status` is `DRAFT` or `REJECTED` are outside this invariant by construction: they
cannot be spent against, so there is nothing to check and no ceiling they could exceed.

#### Scenario: Activating a budget with no covering control point creates one

- **WHEN** a budget is activated and no active control point already governs it
- **THEN** a control point is created for that budget's own `account_id` and `department_id`
  in the same fiscal year
- **AND** the budget is governed by at least one active control point

#### Scenario: Activating a budget already covered adds no control point

- **GIVEN** an active control point that already governs the account and department of a budget
  about to be activated
- **WHEN** that budget is activated
- **THEN** no additional control point is created

#### Scenario: A DRAFT budget is owed no coverage

- **GIVEN** a `DRAFT` budget governed by no control point
- **WHEN** the coverage invariant is evaluated
- **THEN** it holds, and no control point is created

#### Scenario: Deactivating the last covering control point is refused

- **GIVEN** an `ACTIVE` budget governed by exactly one active control point
- **WHEN** a request deactivates or deletes that control point
- **THEN** the request is rejected with a 400 naming the budget that would be left uncovered
- **AND** the control point remains active

#### Scenario: Deactivating a redundant control point is allowed

- **GIVEN** an `ACTIVE` budget governed by two active control points
- **WHEN** one of them is deactivated
- **THEN** the request succeeds and the budget remains governed by the other

#### Scenario: A control point covering only DRAFT budgets can be deactivated

- **GIVEN** an active control point whose only governed budgets are `DRAFT`
- **WHEN** a request deactivates it
- **THEN** the request succeeds
