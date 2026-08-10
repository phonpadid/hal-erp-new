## ADDED Requirements

### Requirement: Budget Control Point

The system SHALL provide a `budget_control_point` record that declares WHERE budget
availability is checked, independently of WHERE budget amounts are posted. A control point
SHALL name a `company_id`, a `fiscal_year_id`, an `account_node_id` referencing an `account`
in the same company, a `department_node_id` referencing a `department` in the same company,
a nullable `cap_amount`, a `tolerance_json` ladder, and an `is_active` flag. It SHALL be
unique per `(company_id, fiscal_year_id, account_node_id, department_node_id)`.

A `budget` SHALL be governed by every active control point in the same company and
`fiscal_year_id` whose `account_node_id` is the budget's `account_id` or an ancestor of it
via `account.parent_id`, AND whose `department_node_id` is the budget's `department_id` or
an ancestor of it via `department.parent_dept_id`. A control point MAY be placed at a
postable or a non-postable `account` node; `account.is_postable` SHALL NOT restrict where a
control point may sit, because a control point is a checkpoint and not a posting target.

`cap_amount` SHALL be NULL in this capability's current form, and a request that sets it
SHALL be rejected. A NULL `cap_amount` means the control point's ceiling is the sum of
`budget.amount_total` over the budgets it governs.

#### Scenario: A control point governs a budget through both trees

- **GIVEN** a budget on account `6110` in department `D3`, where `6110`'s ancestors are `611` and
  `61`, and `D3`'s ancestor is `D1`
- **WHEN** an active control point exists for account node `61` and department node `D1` in the
  same company and fiscal year
- **THEN** that control point governs the budget

#### Scenario: A control point matching only one tree does not govern

- **GIVEN** a budget on account `6110` in department `D3`
- **WHEN** an active control point exists for account node `61` and a department node that is
  neither `D3` nor an ancestor of `D3`
- **THEN** that control point does not govern the budget

#### Scenario: A control point never governs across companies

- **GIVEN** a control point in company A and a budget in company B
- **WHEN** the governing control points of the company B budget are resolved
- **THEN** the company A control point is not among them

#### Scenario: A control point may sit on a non-postable account node

- **WHEN** a control point is created with an `account_node_id` whose `account.is_postable` is
  false
- **THEN** the control point is created

#### Scenario: A non-null cap amount is rejected

- **WHEN** a control point is created or updated with a non-null `cap_amount`
- **THEN** the request is rejected with a 400

### Requirement: Every Active Budget Is Covered by a Control Point

Every `budget` whose `status` is `ACTIVE` MUST be governed by at least one active
`budget_control_point`. An uncovered budget would have no row to lock and no ceiling to
check, so its spending would be unlimited without any error being raised. The system SHALL
enforce coverage at budget creation and at control-point deactivation or deletion.

#### Scenario: Creating a budget with no covering control point creates one

- **WHEN** an `ACTIVE` budget is created and no active control point already governs it
- **THEN** a control point is created for that budget's own `account_id` and `department_id`
  in the same fiscal year
- **AND** the budget is governed by at least one active control point

#### Scenario: Creating a budget already covered adds no control point

- **GIVEN** an active control point that already governs the account and department of a budget
  about to be created
- **WHEN** that budget is created
- **THEN** no additional control point is created

#### Scenario: Deactivating the last covering control point is refused

- **GIVEN** an `ACTIVE` budget governed by exactly one active control point
- **WHEN** a request deactivates or deletes that control point
- **THEN** the request is rejected with a 400 naming the budget that would be left uncovered
- **AND** the control point remains active

#### Scenario: Deactivating a redundant control point is allowed

- **GIVEN** an `ACTIVE` budget governed by two active control points
- **WHEN** one of them is deactivated
- **THEN** the request succeeds and the budget remains governed by the other

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

- **GIVEN** a control point whose account node and department node are a budget's own
  `account_id` and `department_id`, governing only that budget
- **WHEN** a document reserves against that budget
- **THEN** the accepted and refused amounts are identical to checking that budget row alone

### Requirement: Over-Budget Refusal Identifies the Blocking Control Point

When a submission is refused for insufficient budget, the `BUDGET_EXCEEDED` error SHALL
identify the control point that blocked it and that control point's available amount. A
submitter selects a `budget`, so a refusal that names only the budget is unexplainable when
the blocking ceiling belongs to an ancestor node that still shows the chosen line as having
room.

#### Scenario: Refusal names the control point, not only the budget

- **GIVEN** a budget with 5,000,000 available whose governing control point has 10,000 available
- **WHEN** a document reserving 50,000 against that budget is submitted
- **THEN** the request is rejected with `BUDGET_EXCEEDED`
- **AND** the error identifies the blocking control point and its available amount of 10,000

### Requirement: Control Point Administration

The system SHALL let users holding `BUDGET_MANAGE` create, update, deactivate and list
`budget_control_point` rows in the active company, and SHALL expose the derived available
amount at a control point to users holding `BUDGET_VIEW`. All reads and writes SHALL be
scoped to the active company (invariant 1). No new permission code SHALL be introduced.

#### Scenario: Control point administration is permission-gated

- **WHEN** a request without `BUDGET_MANAGE` tries to create a control point
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: Control point balance read is permission-gated

- **WHEN** a request without `BUDGET_VIEW` tries to read a control point's available amount
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: Control point reads are company-scoped

- **WHEN** a user lists control points while company A is active
- **THEN** only company A's control points are returned

## MODIFIED Requirements

### Requirement: Over-Limit Policy

Each `budget_control_point` SHALL declare a tolerance ladder in `tolerance_json`: an ordered
list of entries of the form `{at: <percent>, action: WARN | BLOCK}`, evaluated against
`(used + requested) / ceiling` at that control point. Every entry whose `at` threshold is met
or exceeded SHALL apply; a matched `BLOCK` MUST reject the submission, and matched `WARN`
entries with no matched `BLOCK` MUST allow the submission and return a warning. A ladder that
is empty or unparseable SHALL be rejected when the control point is written, and SHALL NEVER
be interpreted permissively at check time. `ESCALATE` is not an available action in this
capability.

`budget.control_policy` SHALL NO LONGER decide the outcome of an availability check. Existing
values SHALL be translated when control points are seeded: `HARD_STOP` becomes
`[{at: 100, action: BLOCK}]` and `SOFT_WARNING` becomes `[{at: 100, action: WARN}]`, so
previously configured behaviour is reproduced exactly.

#### Scenario: Hard stop blocks an over-budget submit

- GIVEN a control point with 50,000 available and a ladder of `[{at: 100, action: BLOCK}]`
- WHEN a document line would reserve 60,000 against a budget it governs
- THEN submission MUST be rejected with an over-budget error

#### Scenario: Soft warning allows with a flag

- GIVEN a control point with 50,000 available and a ladder of `[{at: 100, action: WARN}]`
- WHEN a document line would reserve 60,000 against a budget it governs
- THEN submission succeeds and the response carries an over-budget warning

#### Scenario: A lower threshold warns before the ceiling is reached

- GIVEN a control point with a ceiling of 100,000, nothing used, and a ladder of
  `[{at: 80, action: WARN}, {at: 100, action: BLOCK}]`
- WHEN a document line would reserve 85,000 against a budget it governs
- THEN submission succeeds and the response carries a warning

#### Scenario: A matched block dominates a matched warning

- GIVEN a control point with a ceiling of 100,000, nothing used, and a ladder of
  `[{at: 80, action: WARN}, {at: 100, action: BLOCK}]`
- WHEN a document line would reserve 120,000 against a budget it governs
- THEN submission MUST be rejected with an over-budget error

#### Scenario: An empty ladder is rejected at configuration time

- WHEN a control point is created with an empty or unparseable `tolerance_json`
- THEN the request is rejected with a 400 and no control point is created

### Requirement: Concurrency-Safe Reservation

The system SHALL prevent two concurrent submissions from over-committing the same budget
control point by locking every governing `budget_control_point` row with
`LockMode.PESSIMISTIC_WRITE`, in ascending id order, within a single DB transaction, before
any availability check is performed.

The `budget_control_point` row SHALL be the only row locked to serialize budget work: `budget`
rows SHALL NOT be locked by any operation that writes `budget_txn`. Holding two lock classes
would allow a deadlock cycle between a transaction holding a budget row and waiting on a
control point and one holding that control point and waiting on the budget row.

EVERY operation that writes `budget_txn` SHALL acquire the governing control-point locks in
that same order, including operations that cannot over-commit — settlement and release
included. Such an operation is locked in order to be SERIALIZED, not in order to be checked:
the reference-chain hold check reads what a concurrent settlement may be about to change, and
after this rule the control point is the only row at which the two can meet.

#### Scenario: Two concurrent reservations do not both pass

- GIVEN a control point with exactly 100,000 available, blocking at 100 percent
- WHEN two requests each try to reserve 100,000 at the same time
- THEN exactly one MUST succeed and the other MUST be rejected

#### Scenario: No budget row is locked to serialize budget work

- WHEN any operation that writes `budget_txn` runs
- THEN it holds locks on `budget_control_point` rows only, and on no `budget` row

#### Scenario: A settlement cannot release a chain hold mid-check

- GIVEN a document whose reference-chain ancestor holds an outstanding RESERVE on a budget
- WHEN that ancestor is settled at the same time as the successor is submitted
- THEN the two serialize on the budget's governing control point, and the chain is left either
  holding the ancestor's reservation or holding the successor's own — never neither

#### Scenario: Concurrent reservations on different budgets under one control point

- GIVEN a control point with exactly 100,000 available governing budgets A and B, each of which
  individually has more than 80,000 available
- WHEN one request reserves 80,000 against A and another reserves 80,000 against B at the same
  time
- THEN exactly one MUST succeed and the other MUST be rejected

#### Scenario: Documents touching the same control points in different orders do not deadlock

- GIVEN two control points N and M
- WHEN one document charging budgets under N and M and another charging budgets under M and N
  are submitted at the same time
- THEN both requests complete without a deadlock, and each either succeeds or is refused on
  budget grounds

#### Scenario: A transfer racing a reservation cannot jointly over-draw

- GIVEN a control point with exactly 100,000 available
- WHEN a reservation of 80,000 against a budget it governs and an approved transfer of 80,000
  out of another budget it governs execute at the same time
- THEN exactly one MUST succeed and the other MUST be rejected

### Requirement: Reserve on Submit

The system SHALL reserve budget when a budget-consuming document is submitted, creating RESERVE transactions per document line grouped by `budget_id`, EXCEPT for a budget an ancestor of that document in its `ref_document_id` chain is still holding.
A reference chain (`document.ref_document_id`, e.g. `PROC → PO → DISB`) is one spend, so it SHALL
hold a budget exactly once: the chain's hold is taken by the first document in the chain to submit
against that `budget_id` and is the one settlement converts to ACTUAL. A budget is "held" by an
ancestor when that ancestor's outstanding reserve for it — `Σ RESERVE − Σ RELEASE − Σ ACTUAL` for
that `document_id` + `budget_id` — is greater than zero; a settled, released, or never-reserving
ancestor holds nothing and the submitting document SHALL take its own hold. The check SHALL run
inside the submitting transaction and SHALL run after the governing `budget_control_point` rows
have been locked, so a concurrent settlement cannot release between the check and the insert.
Budgets excluded by the ancestor-hold check SHALL be excluded before amounts are summed up to
their governing control points, so a chain that holds a budget once is also checked once.

#### Scenario: Multi-line document reserves per budget
- GIVEN a document with two lines charging two different budgets
- WHEN the document is submitted
- THEN one RESERVE transaction is created against each budget
- AND each reserved amount equals that line's base-currency amount

#### Scenario: A successor does not re-reserve what its predecessor holds
- GIVEN a completed predecessor holding an outstanding RESERVE of 50,000 on a budget
- WHEN a budget-controlled successor created from it is submitted
- THEN no RESERVE is written for that budget against the successor
- AND the budget's available balance is unchanged by the successor's submission

#### Scenario: A held budget is excluded from its control point's check
- GIVEN a completed predecessor holding an outstanding RESERVE of 50,000 on a budget
- WHEN a budget-controlled successor created from it is submitted
- THEN that budget's amount is not counted toward any governing control point's requested total

#### Scenario: A chain is charged exactly once
- GIVEN a chain whose predecessor reserved 50,000 and whose successor reserved nothing
- WHEN the successor is approved and the chain is settled for an actual of 50,000
- THEN the ACTUAL is recorded against the reserving predecessor
- AND no outstanding reserve remains anywhere in the chain
- AND the budget has been reduced by 50,000, not 100,000

#### Scenario: A successor of a settled predecessor takes its own hold
- GIVEN a predecessor whose reservation has already been settled to ACTUAL and RELEASE
- WHEN a budget-controlled successor created from it is submitted
- THEN a RESERVE is written for that budget against the successor

#### Scenario: A document with no predecessor is unaffected
- GIVEN a budget-controlled document with no `ref_document_id`
- WHEN it is submitted
- THEN it reserves its budgeted lines exactly as before

### Requirement: Budget Transfer via Approved Document

A budget transfer SHALL be an approvable document that, on full approval, writes a
paired TRANSFER_OUT and TRANSFER_IN in one DB transaction. The transfer SHALL check
sufficiency at the source budget's governing `budget_control_point` rows rather than at the
source `budget` row, and SHALL lock the union of the source's and the destination's governing
control points in ascending id order before checking — the destination is locked even though
TRANSFER_IN increases availability, because it may be governed by control points a concurrent
reservation is also using.

#### Scenario: Transfer moves money between two budgets
- GIVEN budget X has 100,000 real available and budget Y exists in the same company
- WHEN a transfer document of 100,000 from X to Y is fully approved
- THEN TRANSFER_OUT 100,000 on X and TRANSFER_IN 100,000 on Y are recorded atomically
- AND a transfer MUST be rejected if X lacks sufficient real available balance

#### Scenario: Transfer is refused by the source's control point
- GIVEN budget X with 100,000 available whose governing control point has 20,000 available
- WHEN a transfer of 50,000 from X to another budget is fully approved
- THEN the transfer MUST be rejected for insufficient available balance at the control point

#### Scenario: Transfers in opposite directions do not deadlock
- GIVEN budgets X and Y governed by different control points
- WHEN a transfer from X to Y and a transfer from Y to X execute at the same time
- THEN both complete without a deadlock

### Requirement: Budget Administration and Derived-Balance Query

The system SHALL let authorized users (`BUDGET_MANAGE`) create and maintain `budget`
rows (unique per `fiscal_year` + `department` + `gl_account`) and SHALL expose a
read-only derived-balance query (`BUDGET_VIEW`). `budget.amount_total` is set at
creation and SHALL NOT be overwritten to reflect usage — available balance is always
computed from `budget_txn` (invariant 3). A budget's `gl_account` MUST reference an
active, postable `account` in the budget's company (resolved via the chart-of-accounts
resolver); the resolved account SHALL be recorded on `budget.account_id` alongside the
`gl_account` code. Creation SHALL be rejected when the `gl_account` does not resolve.
Creation SHALL additionally ensure the new budget is governed by at least one active
`budget_control_point`, creating one at the budget's own `account_id` and `department_id`
when none already governs it, within the same transaction as the budget insert.

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

#### Scenario: A newly created budget is never left uncovered

- **WHEN** a budget is created in a fiscal year that has no control point governing its account
  and department
- **THEN** a control point is created for that budget in the same transaction
- **AND** the budget is governed by at least one active control point
