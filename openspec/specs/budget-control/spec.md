# Budget Control Specification

## Purpose
Append-only budget ledger with reserve/actual/release semantics, line-level
consumption, over-limit policy, and approval-gated transfer & adjustment.

## Requirements

### Requirement: Append-Only Budget Ledger
The system SHALL record every budget change as a row in `budget_txn` and MUST NOT
update or delete existing rows. Balance is always derived by summation.

#### Scenario: Balance is computed, never stored mutably
- GIVEN a budget with amount_total 1,000,000
- WHEN a RESERVE of 100,000 and a RELEASE of 40,000 are recorded
- THEN available balance equals amount_total minus reserve plus release
- AND `budget.amount_total` is never overwritten by these operations

### Requirement: Reserve on Submit
The system SHALL reserve budget when a budget-consuming document is submitted,
creating RESERVE transactions per document line grouped by `budget_id`.

#### Scenario: Multi-line document reserves per budget
- GIVEN a document with two lines charging two different budgets
- WHEN the document is submitted
- THEN one RESERVE transaction is created against each budget
- AND each reserved amount equals that line's base-currency amount

### Requirement: Over-Limit Policy
Each budget SHALL declare a control policy of HARD_STOP or SOFT_WARNING. HARD_STOP
MUST block submission when available balance is insufficient; SOFT_WARNING MUST warn
but allow.

#### Scenario: Hard stop blocks an over-budget submit
- GIVEN a HARD_STOP budget with 50,000 available
- WHEN a document line would reserve 60,000 against it
- THEN submission MUST be rejected with an over-budget error

#### Scenario: Soft warning allows with a flag
- GIVEN a SOFT_WARNING budget with 50,000 available
- WHEN a document line would reserve 60,000 against it
- THEN submission succeeds and the response carries an over-budget warning

### Requirement: Concurrency-Safe Reservation
The system SHALL prevent two concurrent submissions from over-committing the same
budget by locking the budget rows within a single DB transaction.

#### Scenario: Two concurrent reservations do not both pass
- GIVEN a HARD_STOP budget with exactly 100,000 available
- WHEN two requests each try to reserve 100,000 at the same time
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
paired TRANSFER_OUT and TRANSFER_IN in one DB transaction.

#### Scenario: Transfer moves money between two budgets
- GIVEN budget X has 100,000 real available and budget Y exists in the same company
- WHEN a transfer document of 100,000 from X to Y is fully approved
- THEN TRANSFER_OUT 100,000 on X and TRANSFER_IN 100,000 on Y are recorded atomically
- AND a transfer MUST be rejected if X lacks sufficient real available balance

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
(increase or decrease); the document's `document_type.post_action` SHALL determine the direction
(`ADJUST_INCREASE` / `ADJUST_DECREASE`) per configuration, not hardcoded branching. Creating the
document and its movement SHALL occur in one DB transaction, scoped to the active company, and
leave the document in a state that enters the normal submit → approval flow. The single
ADJUST_INCREASE / ADJUST_DECREASE txn SHALL be written only by the existing post-action on full
approval — creation alone SHALL NOT write any `budget_txn` row (the ledger stays append-only and
approval-gated).

#### Scenario: Creating an adjustment yields an approvable document, no ledger write yet

- **WHEN** an authorized user creates an increase adjustment of 200,000 on a budget with a reason
- **THEN** a `document` plus a `budget_movement` (target budget, amount 200,000, the reason,
  direction increase) are created in one transaction
- **AND** no `budget_txn` row exists for that document until it is fully approved

#### Scenario: Direction comes from the document type's post_action

- **WHEN** a decrease adjustment is created
- **THEN** the document uses the adjustment type whose `post_action` is `ADJUST_DECREASE`, so on
  approval the post-action writes a single `ADJUST_DECREASE`

#### Scenario: Adjustment cannot bypass approval

- **WHEN** an adjustment document is created but not yet fully approved
- **THEN** the budget's derived available balance is unchanged, because no ADJUST txn has been written

### Requirement: Transfer Request Intake

The system SHALL provide an approval-gated intake that creates a budget transfer as an
approvable document. The intake SHALL require `BUDGET_MANAGE`, and on success SHALL create one
`document` of the transfer document type (whose `post_action` is `TRANSFER`) plus one
`budget_movement` row (`movement_type` `TRANSFER`, `from_budget`, `to_budget`, `amount`,
`reason`) in a single database transaction, and SHALL NOT write any `budget_txn` row. The
document number SHALL be allocated under the existing locked numbering. The paired
`TRANSFER_OUT` / `TRANSFER_IN` `budget_txn` rows SHALL be written only later by the existing
post-action on full approval (append-only ledger). Intake SHALL reject, before creating
anything, a transfer whose source and destination are the same budget, whose source and
destination are in different companies or different `fiscal_year`s, or whose `amount` is not a
positive value; both budgets SHALL be resolved company-scoped so a budget outside the active
company is treated as not found.

#### Scenario: Intake creates a document and movement but no ledger row

- **GIVEN** a `BUDGET_MANAGE` user and two budgets in the same company and fiscal year
- **WHEN** they submit a transfer of 100,000 from one budget to the other
- **THEN** a transfer `document` and a `budget_movement` (`TRANSFER`, from/to, 100,000) are created in one transaction
- **AND** no `budget_txn` row is written and neither budget's derived balance changes

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
