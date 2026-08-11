# Budget Control Specification

## Purpose
Append-only budget ledger with reserve/actual/release semantics, line-level
consumption, over-limit policy, and approval-gated transfer & adjustment.

## Requirements

### Requirement: Append-Only Budget Ledger
The system SHALL record every budget change as a row in `budget_txn` and MUST NOT
update or delete existing rows. Balance is always derived by summation as
`amount_total + Σ ADJUST_INCREASE − Σ ADJUST_DECREASE + Σ TRANSFER_IN − Σ TRANSFER_OUT
− Σ RESERVE + Σ RELEASE`. ACTUAL MUST NOT be subtracted: it draws down an existing
reservation (see Outstanding Reservation Accounting), so the reserve that was never
released already represents the spend. Subtracting ACTUAL as well SHALL be treated as
a defect — it charges the budget twice for the same document.

#### Scenario: Balance is computed, never stored mutably
- GIVEN a budget with amount_total 1,000,000
- WHEN a RESERVE of 100,000 and a RELEASE of 40,000 are recorded
- THEN available balance equals amount_total minus reserve plus release
- AND `budget.amount_total` is never overwritten by these operations

#### Scenario: A fully consumed reservation is charged exactly once
- GIVEN a budget with amount_total 1,000,000
- WHEN a document reserves 100,000 and is then settled for an actual of 100,000
- THEN an ACTUAL of 100,000 is recorded and no RELEASE is recorded
- AND the available balance is 900,000, not 800,000

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

### Requirement: Convert Reserve to Actual
On goods-receipt or payment the system SHALL record ACTUAL for the consumed amount
and RELEASE the unused reserved difference.

#### Scenario: Partial receive settles the difference
- GIVEN a line reserved 100,000
- WHEN goods worth 90,000 are received and finalized
- THEN an ACTUAL of 90,000 and a RELEASE of 10,000 are recorded

### Requirement: Auto-Release on Reject or Cancel
The system SHALL release all reserved budget when a document is rejected or
cancelled.

#### Scenario: Reject releases the reservation
- GIVEN a submitted document holding a 100,000 reservation
- WHEN an approver rejects it
- THEN a RELEASE of 100,000 is recorded and the budget is freed

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

### Requirement: Transfer Boundaries
The system MUST reject budget transfers across companies and across fiscal years.

#### Scenario: Cross-company transfer is forbidden
- GIVEN budget X in company A and budget Z in company B
- WHEN a transfer from X to Z is attempted
- THEN the system MUST reject it as a cross-entity transfer

### Requirement: Budget Adjustment
A budget adjustment SHALL be an approvable document that writes a single
ADJUST_INCREASE or ADJUST_DECREASE on approval.

#### Scenario: Mid-year increase raises the ceiling
- GIVEN an approved adjustment of +200,000 on a budget
- WHEN the ledger is summed
- THEN available balance reflects the increase via ADJUST_INCREASE

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

### Requirement: Outstanding Reservation Accounting

For a given document and budget, the outstanding reserved amount SHALL be computed as
`Σ RESERVE − Σ RELEASE − Σ ACTUAL` over that document+budget's `budget_txn` rows.
`settle` SHALL record ACTUAL for the consumed amount and RELEASE exactly the remaining
outstanding reserved; auto-release SHALL RELEASE exactly the remaining outstanding
reserved. The system MUST NOT release more than was reserved.

#### Scenario: Settle records actual and releases the exact remainder

- **GIVEN** a document holding a 100,000 reservation on a budget
- **WHEN** it is settled for an actual of 90,000
- **THEN** an ACTUAL of 90,000 and a RELEASE of 10,000 are recorded
- **AND** the outstanding reserved for that document+budget becomes 0

#### Scenario: Auto-release frees only what remains

- **GIVEN** a document with 60,000 outstanding reserved on a budget
- **WHEN** the document is rejected or cancelled
- **THEN** a RELEASE of exactly 60,000 is recorded and no further reservation remains

### Requirement: Authorized, Base-Currency Budget Operations

Every budget endpoint SHALL authorize on a permission code (never a role name). Ledger
amounts SHALL be stored in the company base currency; reserve consumes each line's
already-converted base amount (conversion happens upstream in multi-currency). All
ledger writes for one logical operation SHALL occur inside a single database
transaction.

#### Scenario: A paired transfer commits atomically

- **WHEN** a fully-approved transfer executes
- **THEN** the TRANSFER_OUT and TRANSFER_IN rows are written in one transaction, so the
  ledger is never left with only one side

### Requirement: Derived-Balance Breakdown Query

The system SHALL provide a read that returns a budget's derived balance broken into its
components — `amount_total`, summed `ADJUST_INCREASE` / `ADJUST_DECREASE`, `TRANSFER_IN` /
`TRANSFER_OUT`, `RESERVE`, `ACTUAL`, `RELEASE`, and the resulting available — all summed from
`budget_txn` in the company base currency. The read SHALL require `BUDGET_VIEW` and SHALL NOT
mutate `budget.amount_total`.

#### Scenario: Components reconcile to available

- **WHEN** a `BUDGET_VIEW` user requests a budget's breakdown
- **THEN** available equals `amount_total` + ADJUST_INCREASE − ADJUST_DECREASE + TRANSFER_IN −
  TRANSFER_OUT − RESERVE − ACTUAL + RELEASE

### Requirement: Append-Only Ledger Read

The system SHALL provide a read of a budget's `budget_txn` entries (type, amount, source
document, remark, timestamp) ordered most-recent-first, under `BUDGET_VIEW`. The read SHALL be
strictly read-only and never alter the ledger.

#### Scenario: Ledger entries are returned for a budget

- **WHEN** a `BUDGET_VIEW` user requests a budget's ledger
- **THEN** that budget's `budget_txn` rows are returned, newest first

### Requirement: Company-Scoped Budget Reads

Budget reads exposed to clients (list, get, breakdown, ledger) SHALL be scoped to the active
company via the budget's fiscal year / department, so a budget belonging to another company is
never returned (invariant 1).

#### Scenario: List excludes other companies' budgets

- **WHEN** a user lists budgets while company A is active
- **THEN** only company A's budgets are returned

#### Scenario: Cross-company budget is not readable

- **WHEN** a user requests the breakdown or ledger of a budget in another company
- **THEN** the request is rejected (not found)

### Requirement: Context-Safe Budget Reads

Budget read operations (list, get, derived-balance breakdown, append-only ledger) SHALL execute
within a valid EntityManager context — forking their own unit of work when not invoked inside a
caller's transaction — so they never fail with a global-EntityManager context error. Reads
invoked inside a transaction (e.g. reserve/settle) SHALL continue to use the caller's
EntityManager, preserving atomicity.

#### Scenario: Breakdown read succeeds over HTTP

- **WHEN** a `BUDGET_VIEW` user requests a budget's breakdown via the read endpoint
- **THEN** the derived components are returned (not a 500 internal error)

#### Scenario: Reserve still runs in one transaction

- **WHEN** budget balance is computed inside a reservation's transaction
- **THEN** it uses that transaction's EntityManager, not a separate fork

### Requirement: Adjustment Document Creation

The system SHALL let an authorized user (`BUDGET_MANAGE`) create a budget adjustment as an
approvable document carrying a single `budget_movement`. The created movement SHALL record the
target `budget`, the `amount` (DECIMAL, never a float), a free-text `reason`, and the direction
(increase or decrease). The system SHALL resolve the adjustment `document_type` for the active
company by its `post_action` — `ADJUST_INCREASE` for an increase, `ADJUST_DECREASE` for a
decrease — and SHALL NOT resolve it by a hardcoded or reserved `code` (configuration over code,
invariant 7). The candidate set SHALL be the active document types of the active company whose
`post_action` matches the direction (invariant 1). Selection SHALL follow: if no candidate
exists, the system SHALL reject the request as "not configured"; if exactly one candidate
exists, the system SHALL use it; if more than one candidate exists, the request SHALL supply a
`documentTypeId` identifying which candidate to use, and the system SHALL reject an ambiguous
request that omits it. When `documentTypeId` is supplied, the system SHALL reject it unless it
identifies an active document type of the active company whose `post_action` matches the
direction. The document's `document_type.post_action` thus determines the direction per
configuration, not hardcoded branching. Creating the document and its movement SHALL occur in
one DB transaction, scoped to the active company, and leave the document in a state that enters
the normal submit → approval flow. The single ADJUST_INCREASE / ADJUST_DECREASE txn SHALL be
written only by the existing post-action on full approval — creation alone SHALL NOT write any
`budget_txn` row (the ledger stays append-only and approval-gated).

#### Scenario: Creating an adjustment yields an approvable document, no ledger write yet

- **WHEN** an authorized user creates an increase adjustment of 200,000 on a budget with a reason
- **THEN** a `document` plus a `budget_movement` (target budget, amount 200,000, the reason,
  direction increase) are created in one transaction
- **AND** no `budget_txn` row exists for that document until it is fully approved

#### Scenario: Direction comes from the document type's post_action

- **WHEN** a decrease adjustment is created and exactly one decrease type is configured
- **THEN** the system resolves the active company's document type whose `post_action` is
  `ADJUST_DECREASE` (regardless of that type's `code`), so on approval the post-action writes a
  single `ADJUST_DECREASE`

#### Scenario: Resolution is by post_action, not by a reserved code

- **GIVEN** the active company's single increase-adjustment type has a company-specific `code`
  (not the seeded `BUDGET_ADJ_INC`) but still has `post_action` `ADJUST_INCREASE`
- **WHEN** an increase adjustment is created
- **THEN** intake resolves that type by its `post_action` and creates the document successfully

#### Scenario: Multiple configured types require an explicit choice

- **GIVEN** the active company has two active types with `post_action` `ADJUST_INCREASE`
- **WHEN** an increase adjustment is created without a `documentTypeId`
- **THEN** the request is rejected as ambiguous and nothing is created
- **WHEN** the same adjustment is created with a `documentTypeId` naming one of those two types
- **THEN** the document is created using the chosen type

#### Scenario: An invalid documentTypeId is rejected

- **GIVEN** a `documentTypeId` that is inactive, in another company, or whose `post_action` does
  not match the adjustment direction
- **WHEN** an adjustment is created with it
- **THEN** the request is rejected and nothing is created

#### Scenario: Missing configured type is rejected

- **GIVEN** the active company has no active type with `post_action` `ADJUST_INCREASE`
- **WHEN** an increase adjustment is created
- **THEN** the request is rejected as "not configured" and no document or movement is created

#### Scenario: Adjustment cannot bypass approval

- **WHEN** an adjustment document is created but not yet fully approved
- **THEN** the budget's derived available balance is unchanged, because no ADJUST txn has been written

### Requirement: Transfer Request Intake

The system SHALL provide an approval-gated intake that creates a budget transfer as an
approvable document. The intake SHALL require `BUDGET_MANAGE`, and on success SHALL create one
`document` of the transfer document type plus one `budget_movement` row (`movement_type`
`TRANSFER`, `from_budget`, `to_budget`, `amount`, `reason`) in a single database transaction,
and SHALL NOT write any `budget_txn` row. The intake SHALL resolve the transfer `document_type`
from the active document types of the active company whose `post_action` is `TRANSFER`
(invariant 1), and SHALL NOT resolve it by a hardcoded or reserved `code` (configuration over
code, invariant 7). Selection SHALL follow: if no such type exists, the intake SHALL reject the
request as "not configured"; if exactly one exists, the intake SHALL use it; if more than one
exists, the request SHALL supply a `documentTypeId` identifying which to use, and the intake
SHALL reject an ambiguous request that omits it. When `documentTypeId` is supplied, the intake
SHALL reject it unless it identifies an active document type of the active company whose
`post_action` is `TRANSFER`. The document number SHALL be allocated under the existing locked
numbering. The paired `TRANSFER_OUT` / `TRANSFER_IN` `budget_txn` rows SHALL be written only
later by the existing post-action on full approval (append-only ledger). Intake SHALL reject,
before creating anything, a transfer whose source and destination are the same budget, whose
source and destination are in different companies or different `fiscal_year`s, or whose `amount`
is not a positive value; both budgets SHALL be resolved company-scoped so a budget outside the
active company is treated as not found.

#### Scenario: Intake creates a document and movement but no ledger row

- **GIVEN** a `BUDGET_MANAGE` user and two budgets in the same company and fiscal year
- **WHEN** they submit a transfer of 100,000 from one budget to the other
- **THEN** a transfer `document` and a `budget_movement` (`TRANSFER`, from/to, 100,000) are created in one transaction
- **AND** no `budget_txn` row is written and neither budget's derived balance changes

#### Scenario: Transfer type is resolved by post_action

- **WHEN** a valid transfer is submitted and exactly one transfer type is configured
- **THEN** the intake resolves the active company's document type whose `post_action` is
  `TRANSFER` (regardless of that type's `code`) and uses it for the created document

#### Scenario: Multiple transfer types require an explicit choice

- **GIVEN** the active company has two active types with `post_action` `TRANSFER`
- **WHEN** a valid transfer is submitted without a `documentTypeId`
- **THEN** the request is rejected as ambiguous and nothing is created
- **WHEN** the same transfer is submitted with a `documentTypeId` naming one of those types
- **THEN** the document is created using the chosen type

#### Scenario: Missing configured transfer type is rejected

- **GIVEN** the active company has no active type with `post_action` `TRANSFER`
- **WHEN** a valid transfer is submitted to the intake
- **THEN** the request is rejected as "not configured" and nothing is created

#### Scenario: Intake rejects a cross-company transfer

- **GIVEN** a source budget in company A and a destination budget in company B
- **WHEN** a transfer between them is submitted to the intake
- **THEN** the request is rejected before any document or movement is created

#### Scenario: Intake rejects a same-budget or non-positive transfer

- **WHEN** the source and destination budget are the same, or the amount is zero or negative
- **THEN** the request is rejected with a validation error and nothing is created

#### Scenario: Intake is permission-gated

- **WHEN** a request without `BUDGET_MANAGE` calls the transfer intake
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: Full approval writes the paired ledger rows

- **GIVEN** a transfer document created by the intake
- **WHEN** the document is fully approved
- **THEN** the existing post-action writes `TRANSFER_OUT` on the source and `TRANSFER_IN` on the destination atomically, with both budgets locked

### Requirement: Selectable Budgets for Document Creation

The system SHALL expose a read that returns the budgets a document creator may charge a line
to, authorized by the `DOC_CREATE` permission code (not `BUDGET_VIEW`). The read SHALL return
only selection fields for each budget — its `id`, `budget_name`, and `gl_account` — and SHALL
NOT return `amount_total`, any derived balance, breakdown component, or ledger row. It SHALL be
scoped to the active company via the budget's fiscal year / department (invariant 1) and SHALL
return only budgets whose `status` is `ACTIVE`. This read is additive: the existing
amount-bearing budget reads (list, get, derived-balance, breakdown, ledger) remain authorized
by `BUDGET_VIEW` and unchanged.

#### Scenario: Creator without BUDGET_VIEW can list selectable budgets

- **GIVEN** a user who holds `DOC_CREATE` but not `BUDGET_VIEW` in the active company
- **WHEN** the user requests the selectable-budgets read
- **THEN** the active company's `ACTIVE` budgets are returned with `id`, `budgetName`, and
  `glAccount` only, and the request is not rejected for lacking `BUDGET_VIEW`

#### Scenario: Selectable read exposes no financial figures

- **WHEN** any user requests the selectable-budgets read
- **THEN** the response contains no `amountTotal`, available balance, breakdown, or ledger data
  for any budget

#### Scenario: Selectable read is company-scoped

- **WHEN** a user requests the selectable-budgets read while company A is active
- **THEN** only company A's budgets are returned and no budget belonging to another company
  appears

#### Scenario: Inactive budgets are excluded

- **GIVEN** a budget in the active company whose `status` is not `ACTIVE`
- **WHEN** a user requests the selectable-budgets read
- **THEN** that budget is not returned

#### Scenario: Selectable read requires DOC_CREATE

- **GIVEN** a user who holds neither `DOC_CREATE` nor `BUDGET_VIEW`
- **WHEN** the user requests the selectable-budgets read
- **THEN** the request is rejected as unauthorized

### Requirement: Resolve Budget by GL, Department, and Fiscal Year

The system SHALL expose a read that resolves the single `ACTIVE` budget for a given
`gl_account`, `department_id`, and fiscal year (identified by the document date), used
during document line creation to derive a line's `budget_id`. The read SHALL be authorized
by the `DOC_CREATE` permission code (not `BUDGET_VIEW`) and SHALL return only selection
fields — the budget's `id`, `budget_name`, and `gl_account` — never `amount_total`, a
derived balance, a breakdown component, or a ledger row. It SHALL be scoped to the active
company via the budget's fiscal year / department (invariant 1). It SHALL return no budget
when none is `ACTIVE` for the triple, so the caller can reject the line with a clear error.

#### Scenario: A unique active budget resolves

- **GIVEN** exactly one `ACTIVE` budget for fiscal year 2026, department D, and
  `gl_account` `5210` in the active company
- **WHEN** a `DOC_CREATE` user resolves a budget for that triple
- **THEN** that budget's `id`, `budgetName`, and `glAccount` are returned and no
  amount-bearing fields are included

#### Scenario: No active budget resolves to empty

- **GIVEN** no `ACTIVE` budget for the requested fiscal year, department, and `gl_account`
- **WHEN** a `DOC_CREATE` user resolves a budget for that triple
- **THEN** the read returns no budget, allowing the caller to reject the line

#### Scenario: Resolution is company-scoped

- **WHEN** a user resolves a budget while company A is active
- **THEN** only company A's budgets are considered and no other company's budget is
  returned

#### Scenario: Resolve requires DOC_CREATE

- **GIVEN** a user holding neither `DOC_CREATE` nor `BUDGET_VIEW`
- **WHEN** the user calls the resolve-budget read
- **THEN** the request is rejected as unauthorized

### Requirement: Selectable Movement Document Types

The system SHALL expose a read, authorized by `BUDGET_MANAGE`, that returns the document types a
user may choose when creating a budget movement in the active company. The read SHALL group the
active document types by operation: those with `post_action` `ADJUST_INCREASE`, those with
`ADJUST_DECREASE`, and those with `TRANSFER`. For each type it SHALL return only selection
fields — its `id`, `code`, and `name` — and SHALL be scoped to the active company (invariant 1),
returning only active types. The read SHALL exist so a client can decide whether to prompt the
creator to choose a type (more than one) or proceed without prompting (zero or one).

#### Scenario: Read returns movement types grouped by operation

- **GIVEN** a `BUDGET_MANAGE` user in a company with one increase type, one decrease type, and
  two transfer types configured and active
- **WHEN** they request the selectable movement document types
- **THEN** the response groups them by operation, listing `id`, `code`, and `name` per type,
  with two entries under the transfer group

#### Scenario: Read is company-scoped and active-only

- **GIVEN** an inactive adjustment type and a type belonging to another company
- **WHEN** the selectable movement document types are read
- **THEN** neither the inactive type nor the other company's type appears

#### Scenario: Read is permission-gated

- **WHEN** a request without `BUDGET_MANAGE` calls the read
- **THEN** it is rejected with 403 before the handler runs

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

The list read SHALL return, for each control point, its derived `ceiling`, `used` and `available`
and the ids of the budgets it governs, alongside its configuration fields. Without them a caller
showing a list of control points must issue one balance request per row, and a caller grouping
budgets by their governing point must issue one coverage request per budget. The derived figures
SHALL be computed the same way as the single-control-point balance read — never stored on the
control point and never summed by the caller.

#### Scenario: Control point administration is permission-gated

- **WHEN** a request without `BUDGET_MANAGE` tries to create a control point
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: Control point balance read is permission-gated

- **WHEN** a request without `BUDGET_VIEW` tries to read a control point's available amount
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: Control point reads are company-scoped

- **WHEN** a user lists control points while company A is active
- **THEN** only company A's control points are returned

#### Scenario: The list carries each point's derived figures

- **GIVEN** a control point governing budgets whose `amount_total` sums to 534,000,000, with
  487,208,500 reserved against them
- **WHEN** a `BUDGET_VIEW` user lists control points
- **THEN** that row reports a ceiling of 534,000,000, used of 487,208,500 and available of
  46,791,500

#### Scenario: The list carries the ids of the budgets each point governs

- **GIVEN** a control point governing six budgets
- **WHEN** a `BUDGET_VIEW` user lists control points
- **THEN** that row reports the ids of all six budgets

#### Scenario: List figures agree with the single-point balance read

- **WHEN** a control point's available is read from the list and from its own balance endpoint
- **THEN** the two amounts are identical

#### Scenario: A point governing nothing reports zero, not unlimited

- **GIVEN** an active control point that governs no budget
- **WHEN** a `BUDGET_VIEW` user lists control points
- **THEN** that row reports a ceiling of 0, available of 0, and no governed budget ids
