## MODIFIED Requirements

### Requirement: Goods Receipt and Partial Receive

The system SHALL let a `DOC_RECEIVE` user record received quantities against a purchase order's
`document_line` rows, scoped to the active company. Each receipt SHALL accumulate
`document_line.received_qty` and advance `document_line.line_status` from `OPEN` to `PARTIAL`
(when `0 < received_qty < qty`) to `RECEIVED` (when `received_qty >= qty`). A receipt MUST NOT
push `received_qty` above the ordered `qty` (over-receipt is rejected). Concurrent receipts on the
same line SHALL be serialized so quantities are not lost.

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
