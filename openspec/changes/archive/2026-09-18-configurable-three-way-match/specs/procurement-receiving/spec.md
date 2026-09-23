## MODIFIED Requirements

### Requirement: Goods Receipt and Partial Receive

The system SHALL let a `DOC_RECEIVE` user record received quantities against the `document_line`
rows of a document whose type has `receives_goods = true`, scoped to the active company; a receipt
against a document of any other type SHALL be rejected with a validation error naming the type.
Each receipt SHALL accumulate
`document_line.received_qty` and advance `document_line.line_status` from `OPEN` to `PARTIAL`
(when `0 < received_qty < qty`) to `RECEIVED` (when `received_qty >= qty`). A receipt MUST NOT
push `received_qty` above the ordered `qty` (over-receipt is rejected). Concurrent receipts on the
same line SHALL be serialized so quantities are not lost.

Each receipt SHALL also stamp `document_line.last_received_at` with the moment it was recorded.
`received_qty` is a running total with no time attached, so on its own it cannot answer "how much
had been received as at the 30th" — the question a period-close accrual asks. A stock-tracked line
could be reconstructed from `stock_txn.created_at`, but a service or untracked consumable produces
no stock movement, and those are precisely the lines the accrual covers. The column SHALL be
nullable and SHALL stay null for receipts recorded before it existed: their time was never written
down, and inventing one would be a guess presented as data.

A receipt SHALL carry a target `warehouse_id` that resolves to an active `warehouse` of the active
company; a warehouse of another company SHALL be rejected (invariant 1). Within the **same
transaction** that advances `received_qty`, the system SHALL write a `RECEIVE` row in `stock_txn`
for every received line whose `item` has `is_stock_tracked = true`, and SHALL re-average that
`(item, warehouse)` pair's `avg_cost`. The receipt unit cost SHALL be the line's
`budget_base_line_amount / qty` — the base-currency amount already stamped at the submit-time
locked FX rate, so a receipt never recomputes a rate (invariant 6). Lines whose item is untracked,
and item-less lines, SHALL record `received_qty` exactly as they do today and SHALL produce no
`stock_txn` row. A receipt SHALL NOT write any `budget_txn` row: budget was committed when the
purchase document was submitted, and charging it again at receipt would double-count (invariant 3).

Three-way matching semantics SHALL be unchanged by this: `received_qty` remains the quantity
matching reads, whether or not the item is stock-tracked.

#### Scenario: Partial then full receipt advances line status

- **GIVEN** a PO line ordered for qty 10 with `received_qty` 0 (`OPEN`)
- **WHEN** 4 are received, then 6 more
- **THEN** the line is `PARTIAL` at `received_qty` 4, then `RECEIVED` at `received_qty` 10

#### Scenario: A receipt records when it happened

- **WHEN** a receipt advances a line's `received_qty`
- **THEN** `last_received_at` carries the moment it was recorded, for a stock-tracked line and an
  untracked one alike

#### Scenario: Over-receipt is rejected

- **WHEN** a receipt would push `received_qty` above the ordered `qty`
- **THEN** it is rejected and `received_qty` is unchanged

#### Scenario: Concurrent receipts do not lose quantity

- **GIVEN** two receipts of 3 submitted concurrently for the same line ordered for 10
- **WHEN** both commit
- **THEN** `received_qty` is exactly 6 (the line row is locked while updated)

#### Scenario: Receiving a tracked item puts stock in the warehouse

- **GIVEN** a PO line for a stock-tracked item with a `budget_base_line_amount` implying unit cost 120
- **WHEN** 10 are received into a warehouse of the active company
- **THEN** `received_qty` is 10 and a `RECEIVE` of 10 at unit cost 120 exists for that `(item, warehouse)` pair

#### Scenario: Receipt and stock commit atomically

- **GIVEN** a receipt that would write both `received_qty` and a `RECEIVE` row
- **WHEN** the stock write fails
- **THEN** `received_qty` is not advanced either, because both happen in one transaction

#### Scenario: An untracked item receives without touching stock

- **GIVEN** a PO line for an item whose `is_stock_tracked` is false
- **WHEN** it is received
- **THEN** `received_qty` advances as before and no `stock_txn` row is written

#### Scenario: A receipt leaves the budget ledger alone

- **WHEN** a receipt records stock for a tracked item
- **THEN** no `budget_txn` row is created by the receipt

#### Scenario: A receipt into another company's warehouse is rejected

- **WHEN** a receipt names a `warehouse_id` belonging to another company
- **THEN** the receipt is rejected and `received_qty` is unchanged

#### Scenario: A type that does not receive goods refuses receipts

- **GIVEN** an approved `PR` whose type has `receives_goods = false`
- **WHEN** a `DOC_RECEIVE` user records a receipt against it
- **THEN** the receipt is rejected naming the type and no line changes

### Requirement: Three-Way Matching Before Disbursement

The system SHALL match a document that references a predecessor via `ref_document_id` against
that predecessor before it may be submitted, according to its type's `match_mode`: under
`THREE_WAY`, invoiced quantity MUST NOT exceed the predecessor line's `received_qty` and invoiced
amount MUST NOT exceed the predecessor line's ordered amount within the configured tolerance
(default exact); under `TWO_WAY`, only the amount check applies and no receipt is required; under
`NONE`, no matching is performed and the match read returns no lines. `post_action` SHALL play no
part in whether a document is matched. When matching fails the submit SHALL be blocked with a
per-line reason. The system SHALL also expose a read of the per-line match result (ordered vs
received vs invoiced) for display.

#### Scenario: Paying for more than received is blocked

- **GIVEN** a PO line with `received_qty` 4 and a disbursement type with `match_mode` `THREE_WAY`
- **WHEN** a disbursement referencing the PO is submitted invoicing qty 6 on that line
- **THEN** the submit is blocked with a not-received reason

#### Scenario: Matched disbursement passes

- **GIVEN** a PO whose lines are fully `RECEIVED`
- **WHEN** a disbursement invoices quantities and amounts within received and tolerance
- **THEN** matching passes and the disbursement may be submitted

#### Scenario: Match result is readable

- **WHEN** the match read is requested for a disbursement referencing a PO
- **THEN** it returns per line the ordered, received, and invoiced quantities and amounts

#### Scenario: Two-way needs no receipt

- **GIVEN** a PO line with `received_qty` 0 and a service disbursement type with `match_mode` `TWO_WAY`
- **WHEN** a disbursement invoices the full ordered quantity at the ordered amount
- **THEN** matching passes

#### Scenario: Two-way still checks the amount

- **GIVEN** a `TWO_WAY` disbursement type
- **WHEN** a disbursement invoices more than the PO line's ordered amount
- **THEN** the submit is blocked with an amount reason

#### Scenario: A PO that closes the chain is not matched against its PR

- **GIVEN** a `PO` type with `post_action` `CUT_BUDGET` and `match_mode` `NONE`, raised from a `PR` with no prices and no receipts
- **WHEN** the PO is submitted
- **THEN** no matching runs, the PO reserves its own budget, and the submit succeeds
