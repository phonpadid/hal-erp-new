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

No `budget_txn` row SHALL be written against a budget whose `status` is `CLOSED`. The refusal SHALL
happen where budget rows are written — the single point every `budget_txn` passes through — so that
no call site can bypass it and a writer added later is covered by construction, exactly as
`gl-journal` refuses an entry dated in a closed period at its one constructor. The refusal SHALL
name the budget and its fiscal year rather than failing anonymously.

This is what makes a closed year closed on the budget side: a re-queued posting delivering late, an
adjustment approved against last year, or a capability written after this one cannot quietly consume
an appropriation whose year is finished.

#### Scenario: A closed year's appropriation refuses new rows

- **GIVEN** a budget whose fiscal year has been closed
- **WHEN** anything attempts to write a `RESERVE`, `ACTUAL`, `RELEASE`, `TRANSFER` or `ADJUST`
  against it
- **THEN** the write is refused, naming the budget and its year, and no row is written

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

### Requirement: Proposing A Budget Needs Only The Permission That Proposes Budgets

The system SHALL offer the reads a budget proposal needs — the fiscal years a budget may be
proposed for, and the departments it may be proposed for — authorized by `BUDGET_MANAGE`, the same
permission that authorizes proposing. A holder of `BUDGET_MANAGE` SHALL be able to obtain every
value the proposal requires without holding any organisation-administration permission.

Both reads SHALL be scoped to the active company (invariant 1) and SHALL return identifying fields
only. A read that feeds a picker has no business carrying figures, and a list of names must not
become a side channel for what a budget or a company is worth.

The department read SHALL offer every active department of the active company, not only those that
already hold a budget. The existing filter read deliberately offers only budgeted departments,
because a filter must never present an option that yields nothing; a proposal needs the opposite,
since a department's FIRST budget is exactly what is being proposed.

Authorizing a read by the endpoint that happens to own it, rather than by the act it serves, is how
the budget officer was locked out of the form built for them: the pickers were fed from the
organisation directory, which requires `DEPARTMENT_VIEW` and `FISCAL_YEAR_MANAGE`, and the one user
holding `BUDGET_MANAGE` in the company held neither.

#### Scenario: A budget officer can read the fiscal years to propose against

- **GIVEN** a user holding `BUDGET_MANAGE` and neither `FISCAL_YEAR_MANAGE` nor `DEPARTMENT_VIEW`
- **WHEN** they request the fiscal years a budget may be proposed for
- **THEN** the active company's fiscal years are returned

#### Scenario: A budget officer can read the departments to propose for

- **GIVEN** the same user
- **WHEN** they request the departments a budget may be proposed for
- **THEN** the active company's active departments are returned

#### Scenario: A department holding no budget is still offered

- **GIVEN** an active department with no `budget` row of its own
- **WHEN** the departments a budget may be proposed for are read
- **THEN** that department is among them, so its first budget can be proposed

#### Scenario: Neither read crosses a company

- **GIVEN** a department and a fiscal year of another company
- **WHEN** either read is made in the active company
- **THEN** neither is returned (invariant 1)

#### Scenario: Neither read carries a figure

- **WHEN** either read is made
- **THEN** it returns identifying fields only, and no `amount_total`, balance or other monetary
  value

#### Scenario: Both reads are permission-gated

- **WHEN** a request without `BUDGET_MANAGE` is made to either read
- **THEN** it is rejected with 403 before the handler runs

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
`budget_txn` in the company base currency. `ACTUAL` SHALL be reported as a component and SHALL NOT
be subtracted from available: it draws down a reservation that already reduced the balance (see
`Append-Only Budget Ledger` and `Outstanding Reservation Accounting`), so subtracting it as well
would charge the budget twice. The read SHALL require `BUDGET_VIEW` and SHALL NOT mutate
`budget.amount_total`.

The read SHALL accept an optional as-of date and, when given one, SHALL fold only the `budget_txn`
rows whose `txn_date` is on or before it, so a figure stated for a past day can be reproduced. The
default SHALL be today, leaving the read's meaning unchanged for a caller that asks for none.

#### Scenario: A figure can be stated as of a past day

- **GIVEN** a budget whose ledger holds a RESERVE dated 20 June and another dated 5 July
- **WHEN** the breakdown is read as of 30 June
- **THEN** only the June reservation is folded into the figures

#### Scenario: Components reconcile to available

- **WHEN** a `BUDGET_VIEW` user requests a budget's breakdown
- **THEN** available equals `amount_total` + ADJUST_INCREASE − ADJUST_DECREASE + TRANSFER_IN −
  TRANSFER_OUT − RESERVE + RELEASE

#### Scenario: A settled document does not deduct twice

- **GIVEN** a budget with `amount_total` 1,000,000 whose ledger holds a RESERVE of 100,000, an
  ACTUAL of 90,000 and a RELEASE of 10,000 for one document
- **WHEN** a `BUDGET_VIEW` user requests its breakdown
- **THEN** `actual` is reported as 90,000 and available is 910,000 — not 820,000

### Requirement: Append-Only Ledger Read

The system SHALL provide a read of a budget's `budget_txn` entries (type, amount, source
document, remark, the day of the event `txn_date`, and the insert timestamp) ordered
most-recent-first, under `BUDGET_VIEW`. The read SHALL be strictly read-only and never alter the
ledger.

The read SHALL accept an optional as-of date and, when given one, SHALL return only the rows whose
`txn_date` is on or before it.

#### Scenario: Ledger entries are returned for a budget

- **WHEN** a `BUDGET_VIEW` user requests a budget's ledger
- **THEN** that budget's `budget_txn` rows are returned, newest first, each stating the day its
  event happened

#### Scenario: The ledger read can be bounded to a past day

- **WHEN** a `BUDGET_VIEW` user reads a budget's ledger as of a past date
- **THEN** only rows whose `txn_date` is on or before that date are returned

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
to, authorized by the `DOC_CREATE` permission code (not `BUDGET_VIEW`). This read is how a line
gets its budget: the budget is named by the requester, never derived from the line's account.

The read SHALL return only selection fields for each budget — its `id`, its node's `code`, its
`budget_name`, its node's `parent_id`, the `code` and `name` of that parent node, and the budget's
own `gl_account` — and SHALL NOT return `amount_total`, any derived balance, breakdown component, or
ledger row. It SHALL be scoped to the active company via the budget's fiscal year / department
(invariant 1) and SHALL return only budgets whose `status` is `ACTIVE`. It SHALL be filterable by
department, so a requester is offered their own department's budgets rather than every budget in the
company. This read is additive: the existing amount-bearing budget reads (list, get, derived-balance,
breakdown, ledger) remain authorized by `BUDGET_VIEW` and unchanged.

The `gl_account` travels with each budget so a client can tell which budgets carry a given account
without a second read. It SHALL be absent, rather than empty, for a budget that records none — a
budget whose spending posts to several accounts records no single one, and "spans several accounts"
must stay distinguishable from "posts to an account named by the empty string". Returning it SHALL
NOT be read as reinstating derivation: `budget.gl_account` is an account code, not a figure and not
an instruction, and the requirement above still stands — the server derives no budget from a line's
account, and a client that uses this field to offer a default still sends an explicit `budget_id`
that the server validates on its own terms.

The parent's `code` and `name` travel with the budget because `parent_id` alone cannot be resolved
by the caller. A budget's parent is usually a CATEGORY node, which holds no money and is therefore
never itself a selectable budget — so it never appears in this response. In the customer's largest
department 85 of 92 budgets have such a parent, leaving the client an identifier that matches
nothing it was given. The category is the only structure in the data that distinguishes budgets
whose own names differ by a single word, and a requester choosing among ninety of them needs it.

A category's `name` is a label, not a financial figure. Returning it SHALL NOT be read as weakening
the rule above: this read carries no money, and it is gated on `DOC_CREATE` rather than
`BUDGET_VIEW` so that a requester who may not read budget figures can still raise a document.

Where a budget's node has no parent, the parent fields SHALL be absent rather than empty strings, so
"has no category" stays distinguishable from "has a category with no name".

The read MAY be given a `documentId`. When it is, the response SHALL also include every `ACTIVE`
budget carried by that document's `document_line` rows, provided the document belongs to the
active company (invariant 1); a document of another company adds nothing. A budget added only
because the document carries it SHALL be flagged `inherited: true`; one the caller could select
anyway SHALL appear once, unflagged. A successor raised by create-from carries its predecessor's
budgets, and the person completing it — often in another department — MUST be able to keep them:
the budget was chosen and approved on the predecessor, and a picker that cannot offer it back
turns a correct line into a blocked one. The widening SHALL be exactly the document's own budgets:
it SHALL NOT admit other budgets of the predecessor's department.

The department a caller may see is NOT the client's to choose. It used to be: the read took a
department and the wizard filled it from the signed-in user's own, which hardcoded `DEPARTMENT`
behaviour for everybody however widely they had been granted. The company's budget officer holds
`DOC_CREATE` at `COMPANY`, sits in a department that holds no budget because a budget department
administers the plan rather than spending it, and could therefore submit no `requires_budget`
document at all — offered an empty picker with nothing said.

Budgets carried by a SHARED node SHALL be returned to every caller, whatever their scope and
whatever department they are in. Shared budgets are returned IN ADDITION to what the caller's scope
admits, never instead of them: a department keeps its own budgets and gains the shared ones.

Each returned budget SHALL state whether it is shared, so a caller can tell money its department
owns from money the company holds in common before charging it.

#### Scenario: Creator without BUDGET_VIEW can list selectable budgets

- **GIVEN** a user who holds `DOC_CREATE` but not `BUDGET_VIEW` in the active company
- **WHEN** the user requests the selectable-budgets read
- **THEN** the active company's `ACTIVE` budgets are returned with `id`, `code`, `budgetName`,
  `parentId`, the parent's `code` and `name`, and `glAccount` only, and the request is not rejected
  for lacking `BUDGET_VIEW`

#### Scenario: Selectable read exposes no financial figures

- **WHEN** any user requests the selectable-budgets read
- **THEN** the response contains no `amountTotal`, available balance, breakdown, or ledger data
  for any budget

#### Scenario: A budget names the account it posts to

- **GIVEN** a budget whose `gl_account` is set
- **WHEN** a user requests the selectable-budgets read
- **THEN** that budget's entry carries that `gl_account`

#### Scenario: A budget spanning several accounts names none

- **GIVEN** a budget whose `gl_account` is null because its spending posts to several accounts
- **WHEN** a user requests the selectable-budgets read
- **THEN** the `glAccount` field is absent from that budget's entry rather than an empty string

#### Scenario: A budget under a category names that category

- **GIVEN** a budget whose node hangs off a category node that holds no budget of its own
- **WHEN** a user requests the selectable-budgets read
- **THEN** that budget carries the category node's `code` and `name`, even though the category is
  not itself returned as a selectable budget

#### Scenario: A budget with no parent carries no category

- **GIVEN** a budget whose node has no parent
- **WHEN** a user requests the selectable-budgets read
- **THEN** the parent fields are absent from that budget's entry

#### Scenario: Selectable read is company-scoped

- **WHEN** a user requests the selectable-budgets read while company A is active
- **THEN** only company A's budgets are returned and no budget belonging to another company
  appears

#### Scenario: A DEPARTMENT-scope caller sees their own department's budgets

- **GIVEN** a user granted `DOC_CREATE` at `DEPARTMENT`
- **WHEN** they request the selectable-budgets read
- **THEN** only their own department's budgets are returned, plus any shared ones

#### Scenario: A COMPANY-scope caller sees the company's budgets

- **GIVEN** a user granted `DOC_CREATE` at `COMPANY`, in a department that holds no budget
- **WHEN** they request the selectable-budgets read
- **THEN** the active company's budgets are returned, and the response is not empty

#### Scenario: A caller cannot widen their own scope

- **GIVEN** a user granted `DOC_CREATE` at `DEPARTMENT`
- **WHEN** they request the selectable-budgets read naming another department
- **THEN** no budget outside their own department is returned that is not shared

#### Scenario: A wider caller may narrow to one department

- **GIVEN** a user granted `DOC_CREATE` at `COMPANY`
- **WHEN** they request the selectable-budgets read naming one department
- **THEN** only that department's budgets are returned

#### Scenario: Inactive budgets are excluded

- **GIVEN** a budget in the active company whose `status` is not `ACTIVE`
- **WHEN** a user requests the selectable-budgets read
- **THEN** that budget is not returned

#### Scenario: A shared budget reaches a department that does not own it

- **GIVEN** a budget whose node hangs beneath a node marked as shared, held by another department
- **WHEN** a `DEPARTMENT`-scope user of a different department requests the selectable-budgets read
- **THEN** that budget is returned and is marked as shared

#### Scenario: Shared does not replace a department's own budgets

- **GIVEN** a department that holds budgets of its own, and a shared node elsewhere in the plan
- **WHEN** a `DEPARTMENT`-scope user of that department requests the selectable-budgets read
- **THEN** both its own budgets and the shared ones are returned

#### Scenario: A shared budget of another company is still not returned

- **GIVEN** a node marked as shared in company B
- **WHEN** a user requests the selectable-budgets read while company A is active
- **THEN** no budget beneath it appears (invariant 1)

#### Scenario: A successor keeps the budget it inherited

- **GIVEN** a PR raised in ADM charging ADM's budget, and a PO created from it whose lines carry that budget
- **WHEN** a `DEPARTMENT`-scope Procurement user requests the selectable-budgets read naming the PO
- **THEN** ADM's budget is returned, flagged `inherited`, alongside Procurement's own budgets

#### Scenario: Inheritance does not open the predecessor's department

- **GIVEN** the same PO, and a second ADM budget the PR never named
- **WHEN** the Procurement user requests the read naming the PO
- **THEN** that second budget is not returned

#### Scenario: A budget the caller could select anyway is not flagged

- **GIVEN** a PO whose line carries a budget of the caller's own department
- **WHEN** the caller requests the read naming the PO
- **THEN** that budget appears once and is not flagged `inherited`

#### Scenario: An inactive inherited budget stays unavailable

- **GIVEN** a draft whose line carries a budget whose `status` is no longer `ACTIVE`
- **WHEN** the read is requested naming the draft
- **THEN** that budget is not returned

#### Scenario: A document of another company adds nothing

- **WHEN** a user in company A requests the read naming a document of company B
- **THEN** the response is exactly what it would be without `documentId`

### Requirement: A Plan Node May Carry Shared Budget

The system SHALL let a `BUDGET_MANAGE` user mark a `budget_node` as carrying shared budget. A budget
SHALL be shared when its own node is marked, or when any ancestor of its node is marked — the same
walk that decides which control points govern a budget.

A shared budget is money the company holds in common and any department may charge; it is not money
that stops belonging to the department that holds it. `budget.department_id` is unchanged by the
mark, so the budget keeps its owner for control-point coverage, for its own page, and for every
report that asks whose appropriation it is.

The mark states in the data what was previously carried only in people's heads. On the customer's
plan, `1.100 ຄ່າບໍລິຫານ ທົວໄປ` and `1.400 ລາຍຈ່າຍປະຈຳເດືອນ` hold the office supplies, the security
guards, the phone bills and the cleaning contract that every department consumes; the workbook that
states the plan has no column that says so, and nothing in the system could.

Marking SHALL be available where the plan tree is shown, and SHALL NOT be offered on the document
form: a requester filling in a document has no business reclassifying the plan.

#### Scenario: Marking a node shares every budget beneath it

- **GIVEN** a node with budgets on it and on its descendants
- **WHEN** a `BUDGET_MANAGE` user marks that node as shared
- **THEN** every budget at or beneath it is shared

#### Scenario: A shared budget keeps its owning department

- **GIVEN** a budget beneath a node marked as shared
- **WHEN** the budget is read
- **THEN** its `department_id` is unchanged, and the control points governing it are unchanged

#### Scenario: Marking is permission-gated

- **WHEN** a request without `BUDGET_MANAGE` tries to mark a node as shared
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: Unmarked is the default

- **GIVEN** a node nobody has marked
- **WHEN** its budgets are read
- **THEN** none of them is shared

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

### Requirement: Availability Is Checked at Governing Control Points

The system SHALL check budget availability at the governing control points of the budgets a
document charges, not at the `budget` rows themselves. Reserved amounts SHALL first be
grouped by `budget_id` as today, then summed up to each governing control point, so that a
document charging several budgets governed by the same control point is checked once against
their combined amount. Every governing control point SHALL be checked; passing the most
specific one SHALL NOT exempt a submission from a wider one. Posting SHALL remain unchanged:
`budget_txn` rows are written against the `budget_id` of each line's budget.

The available amount at a control point SHALL be derived, never stored on the control point:
it is the sum of `budget.amount_total` over the governed budgets **whose status is counted**,
adjusted by the `budget_txn` rows of **every** governed budget using the invariant-3 formula —
plus ADJUST_INCREASE, minus ADJUST_DECREASE, plus TRANSFER_IN, minus TRANSFER_OUT, minus
RESERVE, plus RELEASE, with ACTUAL never subtracted.

A counted status is `ACTIVE` or `CLOSED` — the same set the rest of the system totals by. A
`DRAFT` budget is a proposal nobody has approved, a `REJECTED` one is a proposal somebody
refused, and an `INACTIVE` one is money withdrawn from use; none of the three is an
appropriation, and a ceiling that adds them lets the budgets beside them spend money that was
never granted. The ceiling used to sum every governed row regardless of status, and a rejected
budget of 23,056,000 was observed granting exactly that much room to a sibling whose own
appropriation was zero, under a ladder blocking at 100 percent that was working as written.

The two halves are deliberately asymmetric. A budget that leaves `ACTIVE` carrying outstanding
reservations does not release them by changing status, so its ledger rows SHALL keep counting
against the ceiling: dropping them would hand the group back money it is still holding. Only
`ACTIVE` budgets are selectable for a document, so a `DRAFT` or `REJECTED` budget has no ledger
rows to count either way; the rule is stated for `INACTIVE`, which the status table permits.

Which budgets a control point governs SHALL NOT change. Coverage answers whether a budget is
checked by anything at all, and every `ACTIVE` budget SHALL still be governed; only the money
arithmetic distinguishes statuses.

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

#### Scenario: A rejected budget grants no ceiling

- **GIVEN** a control point governing an `ACTIVE` budget of 0 and a `REJECTED` budget of
  23,056,000 at the same node
- **WHEN** its available amount is derived
- **THEN** the ceiling is 0, not 23,056,000

#### Scenario: A rejected budget cannot be spent through

- **GIVEN** that control point and a ladder blocking at 100 percent
- **WHEN** a document charging the `ACTIVE` budget for 23,056,000 is submitted
- **THEN** it is refused with `BUDGET_EXCEEDED`

#### Scenario: A draft budget grants no ceiling

- **GIVEN** a control point governing an `ACTIVE` budget of 1,000,000 and a `DRAFT` budget of
  500,000 awaiting the approval of the plan carrying it
- **WHEN** its available amount is derived
- **THEN** the ceiling is 1,000,000

#### Scenario: A closed budget still counts

- **GIVEN** a control point governing a `CLOSED` budget of 400,000 and an `ACTIVE` one of 600,000
- **WHEN** its available amount is derived
- **THEN** the ceiling is 1,000,000 — a closed year records what was appropriated and spent

#### Scenario: An inactive budget keeps its commitments against the ceiling

- **GIVEN** a control point governing an `ACTIVE` budget of 1,000,000 and an `INACTIVE` budget of
  200,000 holding an outstanding RESERVE of 50,000
- **WHEN** its available amount is derived
- **THEN** the ceiling is 1,000,000 and used is 50,000, so available is 950,000

#### Scenario: Every read of the ceiling agrees

- **GIVEN** a control point governing budgets of mixed status
- **WHEN** its ceiling is read from the single-point balance, from the batched list, and from the
  breakdown behind its detail screen
- **THEN** the three amounts are identical

#### Scenario: Coverage is unchanged by status

- **GIVEN** a control point governing an `ACTIVE` budget and a `REJECTED` one
- **WHEN** the budgets it governs are listed
- **THEN** both are reported, because governing is not the same question as counting

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

Creating a proposed budget and creating the plan that carries it SHALL be one unit of work, written
inside a single transaction. A failure in either SHALL leave the company exactly as it was.

Split across two commits, a failure after the first leaves a `DRAFT` budget no plan carries. The
dimension index refuses a second proposal for the same line, there is no delete for a budget, and
`REJECTED` — the one status that frees the dimension — is not reachable from the product. The money
is neither spendable nor removable.

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

#### Scenario: A failed plan leaves no budget behind

- **GIVEN** a proposal whose plan cannot be raised — no `ACTIVATE_BUDGET` type is configured
- **WHEN** the proposal is made
- **THEN** it is refused, and no `budget`, `document` or `budget_movement` row exists from it

#### Scenario: Proposing the same dimension twice is a conflict, not a crash

- **GIVEN** a budget already proposed for a node and department
- **WHEN** the same dimension is proposed again
- **THEN** it is refused as a conflict naming the existing budget

### Requirement: A Proposed Budget That Lost Its Plan Can Be Proposed Again

The system SHALL let an authorized user raise a plan for an existing `DRAFT` budget that no plan
carries, so a budget stranded by a partial write has an exit through the product.

The budget MUST be `DRAFT`, MUST belong to the active company, and MUST NOT already be carried by a
plan. Each refusal SHALL name which of the three failed — "already active", "another company's" and
"already has a plan awaiting approval" send a reader to three different actions.

Atomic intake makes stranding unreachable going forward; this is for the rows that predate it and
for any caller that does the two steps itself.

#### Scenario: A stranded draft is re-proposed

- **GIVEN** a `DRAFT` budget that no plan carries
- **WHEN** it is proposed again
- **THEN** a plan document is raised carrying it, and it becomes reachable for approval

#### Scenario: An active budget cannot be re-proposed

- **GIVEN** a budget that is already `ACTIVE`
- **WHEN** it is proposed again
- **THEN** it is refused, naming that it is already in force

#### Scenario: A budget already awaiting approval cannot be re-proposed

- **GIVEN** a `DRAFT` budget carried by a plan that is in approval
- **WHEN** it is proposed again
- **THEN** it is refused, naming the plan that already carries it

#### Scenario: Another company's budget is not re-proposable

- **GIVEN** a `DRAFT` budget of another company
- **WHEN** it is proposed in the active company
- **THEN** it is not resolvable (invariant 1)

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

### Requirement: Narrowing The Budget List

The budget list read MAY accept an optional department filter and an optional status filter, and where given each SHALL be applied to the query **before** the page window.

`total` therefore counts the narrowed set, and a matching row on any page is reachable from the
first. Each SHALL narrow the already-scoped set and
SHALL NOT widen it: a department of another company matches nothing, because company scope
(invariant 1) has already been applied. The filters SHALL compose with each other and with any
search term, as a conjunction.

Neither filter SHALL have a default that hides rows. A list requested with no status filter SHALL
return every status, so that budgets a plan proposed and had turned down are absent from a reader's
view only because that reader chose to exclude them.

The system SHALL provide the department options for that filter through a read gated by the same
permission as the budget list itself, returning the departments that hold at least one budget in the
active company. The general department directory requires a different permission, which a holder of
the budget-read permission need not have — sourcing the options there would present an empty filter
to exactly the readers it exists to serve. That read SHALL return identifying fields only, and no
amount, derived balance, or ledger row.

#### Scenario: A department filter narrows to that department

- **GIVEN** budgets belonging to more than one department in the active company
- **WHEN** the list is requested filtered to one department
- **THEN** only that department's budgets are returned, and `total` is their count

#### Scenario: A status filter sets aside rejected proposals

- **GIVEN** a company holding both ACTIVE and REJECTED budgets
- **WHEN** the list is requested filtered to ACTIVE
- **THEN** no REJECTED budget is returned or counted

#### Scenario: No status filter shows every status

- **GIVEN** a company holding budgets in more than one status
- **WHEN** the list is requested with no status filter
- **THEN** budgets of every status are returned

#### Scenario: Filters compose with a search term

- **GIVEN** a department whose budgets include some matching a term and some not
- **WHEN** the list is requested with both that department and that term
- **THEN** only that department's matching budgets are returned

#### Scenario: A filter cannot reach another company's rows

- **GIVEN** a department belonging to another company
- **WHEN** the list is filtered by it from the active company
- **THEN** nothing is returned, and no other company's budget is counted

#### Scenario: Filter options are readable by a budget reader

- **GIVEN** a user holding the budget-read permission and not the department-directory permission
- **WHEN** they request the departments available to filter by
- **THEN** they receive the departments holding a budget in their company, with no amounts

#### Scenario: A department with no budget is not offered

- **GIVEN** a department in the active company holding no budget
- **WHEN** the filter options are requested
- **THEN** that department is not among them

### Requirement: The Item Master Reads Budgets Well Enough To Name One

The system SHALL offer the item registry a read of the budgets an item may be bound to: the `ACTIVE`
budgets of the active company's open fiscal year. Each row SHALL identify ONE budget well enough to
be named on its own — the plan code (`budget_node.code`, unique within a fiscal year), the budget's
name, the department that holds it, and its `gl_account`. Rows SHALL NOT be merged by `gl_account`:
one account carries many budgets, and a caller that cannot tell them apart cannot bind one.

The read SHALL be authorized by `MASTER_VIEW`, not `BUDGET_VIEW` — whoever maintains the item
registry names the budget an item belongs to and need not be able to read what any budget is worth —
and SHALL be scoped to the active company (invariant 1). It SHALL return identifying fields only: a
read that feeds a picker has no business carrying figures.

#### Scenario: Each budget is identified individually

- **GIVEN** four `ACTIVE` budgets of the open fiscal year whose `gl_account` is all `612.06`
- **WHEN** the item registry reads the budgets an item may be bound to
- **THEN** four rows are returned, each carrying its own plan code, budget name and department

#### Scenario: Read with the permission that maintains the registry

- **GIVEN** a user holding `MASTER_VIEW` and not `BUDGET_VIEW`
- **WHEN** they read the budgets an item may be bound to
- **THEN** the active company's budgets are returned, carrying no amounts

#### Scenario: Another company's budgets are never returned

- **GIVEN** budgets in companies A and B
- **WHEN** the read is made while company A is active
- **THEN** only company A's budgets are returned

