## ADDED Requirements

### Requirement: A Budget's Status Changes Only Along Sanctioned Transitions

`budget.status` SHALL be one of exactly five declared values: `DRAFT`, `ACTIVE`, `INACTIVE`,
`REJECTED`, `CLOSED`. The database SHALL refuse any other value, so that an undeclared status is
unrepresentable regardless of which writer produced it.

The budget update surface SHALL accept a status only when it is declared AND the move from the
budget's current status is one the lifecycle sanctions. The sanctioned moves are exactly:

- `ACTIVE` → `INACTIVE` — suspend a budget, keeping it out of every total and unspendable
- `INACTIVE` → `ACTIVE` — put a suspended budget back in force
- `ACTIVE` → `CLOSED` and `INACTIVE` → `CLOSED` — retire it

Every other move SHALL be refused, naming both the current and the requested status. Writing a
budget's current status back onto itself SHALL be accepted as a no-op rather than refused.

`REJECTED` SHALL be terminal: no transition leads out of it. The recovery for a refused line is to
propose it again, which the freed dimension slot already permits; reviving the row instead would
resurrect a figure an approver turned down, without a second approval and without a record that it
came back.

`DRAFT` SHALL NOT be settable by hand — it is what proposing a budget writes, and a hand-written
`DRAFT` would create a budget no plan carries. `CLOSED` SHALL NOT be reachable from `DRAFT` or
`REJECTED`: a budget that was never in force did not run its year.

Authorization is unchanged — `BUDGET_MANAGE` gates the update — and this requirement governs what
that permission may author, not who holds it.

#### Scenario: A budget is suspended and restored

- **GIVEN** an `ACTIVE` budget
- **WHEN** a `BUDGET_MANAGE` user sets its status to `INACTIVE` and later back to `ACTIVE`
- **THEN** both writes succeed, and while it is `INACTIVE` its amount is counted into no total

#### Scenario: A rejected budget cannot be revived

- **GIVEN** a `REJECTED` budget
- **WHEN** a `BUDGET_MANAGE` user sets its status to `ACTIVE`
- **THEN** the request is refused, naming `REJECTED` and `ACTIVE`, and the budget is still `REJECTED`

#### Scenario: An undeclared status is refused

- **WHEN** a `BUDGET_MANAGE` user sets a budget's status to a value that is not one of the five
- **THEN** the request is refused at validation, before the budget is loaded

#### Scenario: The database refuses an undeclared status whatever the writer

- **WHEN** any writer attempts to store a `budget.status` outside the five declared values
- **THEN** the database rejects the write

#### Scenario: A draft budget is not hand-authored

- **GIVEN** an `ACTIVE` budget
- **WHEN** a `BUDGET_MANAGE` user sets its status to `DRAFT`
- **THEN** the request is refused, since a budget enters `DRAFT` only by being proposed

#### Scenario: Writing the same status again changes nothing

- **GIVEN** an `ACTIVE` budget
- **WHEN** a `BUDGET_MANAGE` user submits the status `ACTIVE`
- **THEN** the request succeeds and the budget is unchanged

## MODIFIED Requirements

### Requirement: Budget Plan Activation

On full approval of a plan the system SHALL activate every budget it carries, atomically. Within a
single transaction it SHALL set each referenced `budget.status` from `DRAFT` to `ACTIVE`, establish
control-point coverage for each of them, and verify that every one is governed by at least one
active `budget_control_point` before committing. If any line cannot be activated the whole
transaction SHALL roll back: a fiscal year SHALL NOT be left partly in force.

Activation SHALL refuse a plan any of whose budgets is not `DRAFT`, naming the budget and the status
it is in, and SHALL NOT activate the remainder. A plan is one proposal: activating part of it would
leave a document reading as fully approved over budgets that were never put in force. This mirrors
the refusals already made when a plan is raised and when a stranded budget is proposed again, and it
is what makes `REJECTED` terminal in force and not only in description — approval SHALL NOT be a
path back out of it.

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

#### Scenario: A plan carrying a rejected budget is not activated

- **GIVEN** a plan whose lines include a budget that is `REJECTED`
- **WHEN** the plan reaches full approval
- **THEN** activation is refused naming that budget and its status, no budget of the plan becomes
  `ACTIVE`, and no control point is created

#### Scenario: A plan carrying only draft budgets activates

- **GIVEN** a plan all of whose budgets are `DRAFT`
- **WHEN** the plan reaches full approval
- **THEN** every one becomes `ACTIVE` in one transaction, each governed by an active control point

### Requirement: Budget Plan Rejection Frees the Proposed Lines

The system SHALL set every `budget` a plan references from `DRAFT` to `REJECTED` when that plan
reaches a TERMINAL unapproved outcome — an approver rejects it, or the requester withdraws it. The
rows SHALL NOT be deleted: `budget_movement.to_budget_id` references them, and the record of what
was proposed and turned down is the point of routing budgets through approval at all.

A plan that is RETURNED SHALL NOT have its budgets marked. A return means the document goes back to
its requester to be corrected and resubmitted, and the budgets are the thing to correct; marking
them would destroy what the return asked for and would leave the corrected plan proposing rows it is
no longer allowed to activate. Returning a plan SHALL still release every hold the document carries,
exactly as a rejection does.

No budget or quota is released for a plan in any of these cases, because a plan holds none.

#### Scenario: Rejecting a plan marks its budgets REJECTED

- **GIVEN** a submitted budget plan carrying two `DRAFT` budgets
- **WHEN** an approver rejects it
- **THEN** both budgets have `status` `REJECTED` and both rows still exist

#### Scenario: Withdrawing a plan marks its budgets REJECTED

- **GIVEN** a submitted budget plan carrying a `DRAFT` budget
- **WHEN** the requester withdraws it
- **THEN** that budget has `status` `REJECTED`

#### Scenario: Returning a plan leaves its budgets DRAFT

- **GIVEN** a submitted budget plan carrying two `DRAFT` budgets
- **WHEN** an approver returns it
- **THEN** both budgets are still `DRAFT`, the document is back with its requester, and the plan can
  be corrected and resubmitted

#### Scenario: A returned plan can be corrected and approved

- **GIVEN** a plan an approver returned
- **WHEN** the requester resubmits it and it reaches full approval
- **THEN** its budgets become `ACTIVE`, having never left `DRAFT`

#### Scenario: A rejected line can be proposed again

- **GIVEN** a rejected plan whose budget for a fiscal year, department and `gl_account` is
  `REJECTED`
- **WHEN** a new plan proposes a budget for the same fiscal year, department and `gl_account`
- **THEN** the new `DRAFT` budget is created successfully

#### Scenario: Rejecting a plan releases nothing

- **WHEN** a budget plan is rejected
- **THEN** no `budget_txn` release row is written
