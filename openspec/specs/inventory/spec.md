# inventory Specification

## Purpose
Stock as a first-class, company-scoped resource: warehouses, an append-only `stock_txn`
ledger whose balances are derived rather than authored, and moving weighted-average costing.
Movements ride the document engine — goods issue, adjustment, and inter-warehouse transfer are
ordinary configured document types, so they inherit workflow routing, forms, `approval_log`,
delegation, and the reject/cancel release hook. Stock follows the same reserve → actual → release
lifecycle as budget and quota, is serialized under `PESSIMISTIC_WRITE` so concurrent issues cannot
oversell, and posts perpetual double-entry GL. Stock never crosses a company boundary, and a stock
movement never writes `budget_txn`.

## Requirements

### Requirement: Company-Scoped Warehouse Master

The system SHALL keep warehouses in a `warehouse` table owned by one company via `company_id`, with a `code` unique within its company (`(company_id, code)`), a `name`, and `is_active`. All warehouse reads and writes SHALL be scoped to the active company (invariant 1); a warehouse of another company MUST NOT be listable or resolvable by id. Warehouse administration SHALL be gated by `INV_MANAGE` and reads by `INV_VIEW`. A warehouse SHALL be deactivated by setting `is_active = false` and MUST NOT be hard-deleted, so historical `stock_txn` rows that reference it stay intact. A deactivated warehouse MUST NOT be selectable on a new document or receipt.

#### Scenario: The same warehouse code may exist in two companies

- **GIVEN** company A owns a warehouse with code `MAIN`
- **WHEN** company B creates a warehouse with code `MAIN`
- **THEN** creation succeeds and each company sees only its own `MAIN`

#### Scenario: A warehouse of another company is not resolvable

- **GIVEN** company A owns a warehouse
- **WHEN** a user with company B active requests that warehouse by id
- **THEN** the request is rejected and the warehouse is not returned

#### Scenario: Deactivation retains the row

- **WHEN** an `INV_MANAGE` user removes a warehouse
- **THEN** the `warehouse` row is retained with `is_active = false` and no row is deleted

#### Scenario: A deactivated warehouse cannot be selected

- **WHEN** a document or receipt names a warehouse whose `is_active` is false
- **THEN** the selection MUST be rejected

### Requirement: Append-Only Stock Ledger

The system SHALL record every stock movement as an insert-only row in `stock_txn`, carrying `company_id`, `item_id`, `warehouse_id`, `txn_type`, `qty` as `decimal(15,4)`, `unit_cost` as `decimal(15,6)`, the `document_id` or receipt that caused it, and `created_by` / `created_at`. `stock_txn` rows MUST NOT be updated or deleted (invariant 2); a correction SHALL be expressed as a new row. `txn_type` SHALL be one of `RESERVE`, `RELEASE`, `ISSUE`, `RECEIVE`, `ADJUST_INCREASE`, `ADJUST_DECREASE`, `TRANSFER_OUT`, `TRANSFER_IN`. Every row SHALL carry a positive `qty`; direction is expressed by `txn_type`, never by a negative quantity. `RESERVE` and `RELEASE` rows SHALL carry no cost and MUST NOT change on-hand quantity or value.

#### Scenario: A movement is never rewritten

- **WHEN** a recorded stock movement must be corrected
- **THEN** a new `stock_txn` row is inserted and the original row is unchanged

#### Scenario: Direction comes from the type, not the sign

- **WHEN** any `stock_txn` row is written
- **THEN** its `qty` is positive and its `txn_type` determines whether it adds or removes stock

#### Scenario: The ledger is company-scoped

- **GIVEN** stock movements exist in company A
- **WHEN** a user with company B active reads the stock ledger
- **THEN** company A's rows are not returned

### Requirement: Derived Stock Balances

The system SHALL maintain one `stock_balance` row per `(company_id, item_id, warehouse_id)` carrying `qty_on_hand`, `qty_reserved`, `avg_cost`, and `total_value`, as a projection of `stock_txn` that MUST be reproducible by replaying the ledger. The balance SHALL be computed as `qty_on_hand` = Σ `RECEIVE` + Σ `TRANSFER_IN` + Σ `ADJUST_INCREASE` − Σ `ISSUE` − Σ `TRANSFER_OUT` − Σ `ADJUST_DECREASE`, and `qty_reserved` = Σ `RESERVE` − Σ `RELEASE` − Σ `ISSUE`. Available quantity SHALL be `qty_on_hand − qty_reserved`. A `stock_balance` row SHALL be written only inside the same transaction as the `stock_txn` rows it reflects, never by a separate job, and the system SHALL NOT overwrite a balance to express usage by any other means (invariant 3). The system SHALL expose an `INV_MANAGE`-gated recompute that rebuilds a balance from its ledger as the repair path.

#### Scenario: Balance replays from the ledger

- **GIVEN** a `(item, warehouse)` pair with a history of receipts, issues, and adjustments
- **WHEN** its balance is recomputed from `stock_txn` alone
- **THEN** the recomputed `qty_on_hand`, `qty_reserved`, and `total_value` equal the stored `stock_balance`

#### Scenario: Issuing discharges the reservation rather than double-counting

- **GIVEN** an item with `qty_on_hand` 10 and a `RESERVE` of 4 (`qty_reserved` 4, available 6)
- **WHEN** the reserving document is fully approved and 4 are issued
- **THEN** `qty_on_hand` is 6, `qty_reserved` is 0, and available is 6

#### Scenario: A balance row is created on first movement

- **GIVEN** an item that has never moved in a warehouse
- **WHEN** its first `stock_txn` row is written
- **THEN** a `stock_balance` row for that pair is created in the same transaction

### Requirement: Moving Weighted-Average Costing

The system SHALL value stock at a moving weighted average held per `(item_id, warehouse_id)` in `stock_balance.avg_cost`, recomputed **only** on inbound value — `RECEIVE`, `TRANSFER_IN`, and `ADJUST_INCREASE` — as `(qty_on_hand × avg_cost + inbound_qty × inbound_unit_cost) / (qty_on_hand + inbound_qty)`. When `qty_on_hand` is zero before an inbound movement, `avg_cost` SHALL be **set** to the inbound unit cost rather than averaged, so no division by zero occurs. An outbound movement SHALL consume at the `avg_cost` prevailing at that moment, stamp that value on the `stock_txn.unit_cost`, and leave `avg_cost` unchanged. `avg_cost` SHALL be stored at `decimal(15,6)`; every amount derived from it for posting SHALL be rounded to the currency's `decimal_places` at posting time. Cost and value MUST be carried as DECIMAL — as string or a Decimal type — and MUST NOT be represented as a JS number on either side of the wire.

#### Scenario: Receipts re-average the unit cost

- **GIVEN** 10 units on hand at an `avg_cost` of 100
- **WHEN** 10 more are received at a unit cost of 120
- **THEN** `qty_on_hand` is 20 and `avg_cost` is 110

#### Scenario: Issuing does not move the average

- **GIVEN** 20 units on hand at an `avg_cost` of 110
- **WHEN** 5 are issued
- **THEN** `avg_cost` is still 110, `total_value` falls by 550, and the `ISSUE` row's `unit_cost` is 110

#### Scenario: First receipt into an empty balance sets the cost

- **GIVEN** an `(item, warehouse)` pair with `qty_on_hand` zero
- **WHEN** units are received at a unit cost of 75
- **THEN** `avg_cost` becomes 75 and no division by zero occurs

#### Scenario: Cost crosses the wire as a decimal string

- **WHEN** a stock balance or ledger row is returned by any read endpoint
- **THEN** `avg_cost`, `unit_cost`, and `total_value` are serialized as decimal strings, not JS numbers

### Requirement: Stock Reserve, Issue, and Release Lifecycle

The system SHALL apply reserve-then-actual to stock exactly as it does to budget (invariant 4): a document whose type `post_action` is `ISSUE_STOCK` or `TRANSFER_STOCK` SHALL `RESERVE` its stock at submit, convert that reservation to `ISSUE` (or to the paired transfer rows) on full approval, and `RELEASE` it on reject or cancel. Availability SHALL be enforced **at submit**, when the reservation is taken, not at approval, so a shortage is visible to the requester rather than surfacing at the last approval step. Before checking availability the system SHALL aggregate the document's lines by `(item_id, warehouse_id)`, so two lines naming the same item in the same warehouse are checked against their combined quantity. If any pair is short, the entire submit SHALL be rejected and no `RESERVE` row SHALL be written for any line. Reject or cancel SHALL ALWAYS release reserved stock (invariant 5), and the release SHALL be idempotent — a document holding no live reservation SHALL write no `RELEASE` row.

#### Scenario: Submit reserves without moving on-hand

- **GIVEN** an item with `qty_on_hand` 10 and nothing reserved
- **WHEN** an issue document for 4 is submitted
- **THEN** `qty_reserved` is 4, `qty_on_hand` is still 10, and available is 6

#### Scenario: Insufficient stock blocks the submit

- **GIVEN** an item with available quantity 3
- **WHEN** an issue document for 5 is submitted
- **THEN** the submit is rejected and no `RESERVE` row is written

#### Scenario: Two lines of the same item are checked together

- **GIVEN** an item with available quantity 10
- **WHEN** a document is submitted with two lines of 6 for that item in the same warehouse
- **THEN** the submit is rejected, because the combined 12 exceeds the available 10

#### Scenario: Rejection releases the reservation

- **GIVEN** a submitted issue document holding a `RESERVE` of 4
- **WHEN** an approver rejects it
- **THEN** a `RELEASE` of 4 is written, `qty_reserved` returns to its prior value, and `qty_on_hand` is unchanged

#### Scenario: Releasing twice writes one release

- **GIVEN** an issue document whose reservation has already been released
- **WHEN** a release is attempted again
- **THEN** no second `RELEASE` row is written and the balance is unchanged

### Requirement: Stock Movements Are Configured, Not Hardcoded

The system SHALL drive every stock movement from `document_type.post_action` — `ISSUE_STOCK`, `ADJUST_STOCK`, and `TRANSFER_STOCK` — so goods issue, stock adjustment, and inter-warehouse transfer are ordinary documents that inherit workflow routing, `form_template`, `approval_log`, delegation, and no-self-approval, and the engine MUST NOT branch on a hardcoded document-type code (invariant 7). A line of such a document SHALL name an `item` whose `is_stock_tracked` is true and which is enabled for the active company; a line naming an untracked item SHALL be rejected at submit. An `ADJUST_STOCK` document SHALL express direction per line and write `ADJUST_INCREASE` or `ADJUST_DECREASE` accordingly, and SHALL carry a reason. A `TRANSFER_STOCK` document SHALL name a source and a destination warehouse, both in the active company; a transfer naming a warehouse of another company SHALL be rejected, because stock never crosses a company boundary (invariant 1).

#### Scenario: An issue document moves stock on full approval

- **GIVEN** a document type with `post_action` `ISSUE_STOCK`
- **WHEN** a document of that type reaches full approval
- **THEN** `ISSUE` rows are written for its lines and `qty_on_hand` falls accordingly

#### Scenario: An untracked item cannot be issued

- **WHEN** an `ISSUE_STOCK` document names an item whose `is_stock_tracked` is false
- **THEN** the submit is rejected

#### Scenario: Transfer writes both sides in one transaction

- **GIVEN** an approved `TRANSFER_STOCK` document from warehouse A to warehouse B
- **WHEN** the post-action runs
- **THEN** a `TRANSFER_OUT` on A and a `TRANSFER_IN` on B are committed together, and neither exists without the other

#### Scenario: Transfer carries the source cost to the destination

- **GIVEN** warehouse A holds an item at `avg_cost` 110 and warehouse B holds 10 of it at `avg_cost` 100
- **WHEN** 10 are transferred from A to B
- **THEN** the `TRANSFER_IN` unit cost is 110 and warehouse B's `avg_cost` becomes 105

#### Scenario: A cross-company transfer is rejected

- **WHEN** a `TRANSFER_STOCK` document names a destination warehouse belonging to another company
- **THEN** the submit is rejected and no `stock_txn` row is written

### Requirement: Serialized Stock Writes

The system SHALL take `LockMode.PESSIMISTIC_WRITE` on every affected `stock_balance` row **before** evaluating availability or recomputing `avg_cost`, and SHALL acquire those locks in a fixed `(item_id, warehouse_id)` order in every code path — including the two-warehouse transfer — so concurrent movements cannot deadlock. Each unit of work that writes `stock_txn` SHALL run inside a single `em.transactional(...)` so a movement and the balance it implies commit atomically, and so paired `TRANSFER_OUT` / `TRANSFER_IN` rows can never be split. Every endpoint that reserves, issues, or re-averages stock SHALL have a concurrency test.

#### Scenario: Concurrent issues cannot oversell

- **GIVEN** an item with available quantity 10
- **WHEN** two issue documents for 6 each are submitted concurrently
- **THEN** exactly one reservation succeeds and the other is rejected, and available never goes negative

#### Scenario: Concurrent receipts average correctly

- **GIVEN** an empty balance
- **WHEN** two receipts of 10 at 100 and 10 at 120 commit concurrently
- **THEN** the final `qty_on_hand` is 20 and `avg_cost` is 110, matching the serial result

#### Scenario: Opposing transfers do not deadlock

- **WHEN** a transfer from warehouse A to B and a transfer from B to A commit concurrently for the same item
- **THEN** both complete without deadlock because balance locks are taken in a fixed order

### Requirement: Perpetual GL Posting for Stock Movements

The system SHALL post a balanced `journal_entry` for every stock movement that changes value, idempotent on `(company_id, source_type, source_id)` with `source_type` of `STOCK_TXN`, so a retry never double-posts. A receipt SHALL debit `INVENTORY` and credit `GRNI` (goods received not invoiced), so the asset and the obligation to pay for it appear together; the settling payment then clears `GRNI` rather than expensing the goods a second time. An issue SHALL debit the item's `item_company.default_gl_account` and credit `INVENTORY` — the one point at which a stock purchase becomes an expense. An increase adjustment SHALL debit `INVENTORY` and credit `INVENTORY_ADJUSTMENT`, and a decrease adjustment SHALL post the reverse. An intra-company transfer SHALL NOT post, because both ends resolve to the same `INVENTORY` account. All accounts SHALL resolve through the `account_role` map for the active company and MUST NOT be hardcoded account codes (invariant 7). Amounts SHALL be rounded to the currency's `decimal_places` and any rounding residual SHALL be absorbed into the inventory line so `SUM(debit)` equals `SUM(credit)`. A role that is unmapped, inactive, or in another company SHALL make the posting a logged failure and MUST NOT roll back or crash the stock movement itself, matching the existing posting contract. A `RESERVE` or `RELEASE` SHALL NOT post to the GL, because no value has moved.

#### Scenario: Issuing expenses the item and credits inventory

- **WHEN** an `ISSUE_STOCK` document is fully approved for value 550
- **THEN** a balanced entry debits the item's per-company GL 550 and credits the `INVENTORY` account 550

#### Scenario: Posting is idempotent per movement

- **WHEN** the posting for the same `stock_txn` is attempted twice
- **THEN** exactly one `journal_entry` exists for that `(source_type, source_id)`

#### Scenario: A missing account role fails only the posting

- **GIVEN** a company with no active `INVENTORY` role mapping
- **WHEN** a stock movement is approved
- **THEN** the movement and its `stock_txn` rows are committed, and the posting is skipped and logged

#### Scenario: A reservation does not post

- **WHEN** an issue document is submitted and reserves stock
- **THEN** no `journal_entry` is created for the reservation

### Requirement: Stock Movements Never Charge the Budget

The system SHALL NOT write any `budget_txn` row as a consequence of a stock movement. Budget is committed when the purchase document is submitted and actualized at payment; capitalizing a receipt into inventory or expensing an issue is an accounting event, not a budget event, and writing both would charge the same purchase twice (invariant 3). A goods receipt that both advances `received_qty` and writes `RECEIVE` rows SHALL leave the budget ledger untouched.

#### Scenario: A receipt writes no budget transaction

- **WHEN** a goods receipt against a purchase order records stock into a warehouse
- **THEN** `stock_txn` rows are written and no `budget_txn` row is created by the receipt

#### Scenario: An issue writes no budget transaction

- **WHEN** an `ISSUE_STOCK` document is fully approved
- **THEN** stock and GL are written and no `budget_txn` row is created

### Requirement: Authorized, Company-Scoped Inventory Read Surfaces

The system SHALL expose an on-hand read returning `qty_on_hand`, `qty_reserved`, available quantity, `avg_cost`, and `total_value` per `(item, warehouse)`, and a movement-history read returning `stock_txn` rows for an item with a running balance, both gated by `INV_VIEW` and scoped to the caller's active company. Write surfaces SHALL be gated by `INV_ISSUE`, `INV_ADJUST`, `INV_TRANSFER`, or `INV_MANAGE` as appropriate. Authorization SHALL be evaluated on permission codes, never on role names (invariant 5). There SHALL be no endpoint that creates, updates, or deletes a `stock_txn` row directly — ledger rows are produced only by the receipt hook and the post-action dispatcher.

#### Scenario: Reads are scoped to the active company

- **GIVEN** stock exists in company A and company B
- **WHEN** a user with company A active reads on-hand quantities
- **THEN** only company A's balances are returned

#### Scenario: A user without the permission code is refused

- **WHEN** a user lacking `INV_VIEW` requests on-hand quantities
- **THEN** the request is refused

#### Scenario: The ledger has no direct write endpoint

- **WHEN** a client attempts to create a `stock_txn` row directly
- **THEN** no such endpoint exists and the attempt fails

### Requirement: Requester Warehouse Selection Read

The system SHALL expose a requester-facing warehouse read, authorized by the document-create
permission `DOC_CREATE` (not `INV_VIEW`), mirroring the budget picker read `GET /budgets/selectable`.
It SHALL return the active company's active warehouses, each with its `id`, `code` and `name`, and
nothing else — no stock figures and no balances. The read SHALL be company-scoped and SHALL NOT
require any inventory administration permission.

A document type configured `requires_warehouse` cannot be submitted without naming one, so the
person raising it must be able to list them. Gating that list behind `INV_VIEW` left the required
field empty for exactly the role that raises the document: the picker failed soft, rendered no
options, and the document could never leave `DRAFT`.

The existing administration read SHALL keep `INV_VIEW`. This is an additional, narrower read rather
than a relaxation of the one that returns the full warehouse record.

#### Scenario: A requester lists selectable warehouses without INV_VIEW

- **WHEN** a user holding `DOC_CREATE` but not `INV_VIEW` requests the selectable warehouse read
- **THEN** the active company's active warehouses are returned and no authorization error occurs

#### Scenario: The administration read is unchanged

- **WHEN** a user without `INV_VIEW` requests the full warehouse list
- **THEN** the request is still refused

#### Scenario: Only this company's warehouses are offered

- **WHEN** a requester lists selectable warehouses
- **THEN** only the active company's warehouses appear (invariant 1), and inactive ones do not
