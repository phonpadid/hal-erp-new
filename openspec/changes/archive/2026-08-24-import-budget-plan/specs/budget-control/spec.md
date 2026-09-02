## MODIFIED Requirements

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
the plan's budgets also governs the plan's budgets below it in the node and department trees, so
a second, narrower point for those SHALL NOT be created: it would impose a ceiling nobody asked
for, on top of one that already checks them.

Activation SHALL process lines in a deterministic order — department tree depth, then `dept_code`,
then the budget's node code — so that activating the same plan content always yields the same
control points. Shallowest-first is what makes the created point land as high in the department
tree as the plan reaches, rather than depending on the order rows come back from the database.

A control point created during activation SHALL be scoped to the budget's own `node_id` and
`department_id` and SHALL block at its ceiling.

Activation SHALL NOT require the budget to name a GL account. `gl_account` is an optional hint that
records where a budget's spending tends to post; the control point is scoped to the budget's node,
which every budget has. A budget whose spending posts to several accounts names none, and refusing
to activate it would make a legitimate budget permanently unusable.

Activation SHALL be refused when the plan's `fiscal_year.status` is not `OPEN`. Bringing a budget
into force in a year the rest of the module treats as finished would create spendable budget for a
closed period. The check belongs at activation rather than at intake: drafting a plan for a year
that has not opened yet is legitimate, spending against it is not.

#### Scenario: Approving a plan activates every budget on it

- **GIVEN** an approved budget plan carrying three `DRAFT` budgets
- **WHEN** the post-action runs
- **THEN** all three budgets have `status` `ACTIVE` and each is governed by at least one active
  control point

#### Scenario: A budget naming no GL account activates

- **GIVEN** an approved plan carrying a budget whose `gl_account` is null
- **WHEN** the post-action runs
- **THEN** the budget is `ACTIVE` and a control point scoped to its node governs it

#### Scenario: A plan that cannot be fully activated activates nothing

- **GIVEN** an approved budget plan whose activation fails on one line
- **WHEN** the post-action runs and its bounded retry is exhausted
- **THEN** no budget on the plan is `ACTIVE` and the terminal transition is rolled back

#### Scenario: Activation writes no ledger row

- **GIVEN** an approved budget plan
- **WHEN** its budgets are activated
- **THEN** no `budget_txn` row is written for any of them
