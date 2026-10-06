## MODIFIED Requirements

### Requirement: Derived Stock Balances

The system SHALL maintain one `stock_balance` row per `(company_id, item_id, warehouse_id)` carrying `qty_on_hand`, `qty_reserved`, `avg_cost`, and `total_value`, as a projection of `stock_txn` that MUST be reproducible by replaying the ledger. The balance SHALL be computed as `qty_on_hand` = Σ `RECEIVE` + Σ `TRANSFER_IN` + Σ `ADJUST_INCREASE` − Σ `ISSUE` − Σ `TRANSFER_OUT` − Σ `ADJUST_DECREASE`, and `qty_reserved` = Σ `RESERVE` − Σ `RELEASE` − Σ `ISSUE` − Σ `TRANSFER_OUT`. Available quantity SHALL be `qty_on_hand − qty_reserved`. Every movement type that consumes a reservation — `RELEASE`, `ISSUE` and `TRANSFER_OUT` — SHALL discharge it from one shared definition, so the live write path and the `INV_MANAGE` recompute can never disagree about what a document still holds. A `stock_balance` row SHALL be written only inside the same transaction as the `stock_txn` rows it reflects, never by a separate job, and the system SHALL NOT overwrite a balance to express usage by any other means (invariant 3). The system SHALL expose an `INV_MANAGE`-gated recompute that rebuilds a balance from its ledger as the repair path.

#### Scenario: Balance replays from the ledger

- **GIVEN** a `(item, warehouse)` pair with a history of receipts, issues, and adjustments
- **WHEN** its balance is recomputed from `stock_txn` alone
- **THEN** the recomputed `qty_on_hand`, `qty_reserved`, and `total_value` equal the stored `stock_balance`

#### Scenario: Issuing discharges the reservation rather than double-counting

- **GIVEN** an item with `qty_on_hand` 10 and a `RESERVE` of 4 (`qty_reserved` 4, available 6)
- **WHEN** the reserving document is fully approved and 4 are issued
- **THEN** `qty_on_hand` is 6, `qty_reserved` is 0, and available is 6

#### Scenario: Transferring out discharges the reservation it took

- **GIVEN** a source warehouse with `qty_on_hand` 50 and a transfer document holding a `RESERVE` of 20 (`qty_reserved` 20, available 30)
- **WHEN** that document is fully approved and its `TRANSFER_OUT` is written
- **THEN** the source's `qty_on_hand` is 30, `qty_reserved` is 0, and available is 30
- **AND** no further transfer of the same item is refused for stock the source still holds

#### Scenario: A finished transfer leaves no hold for the recompute to find

- **GIVEN** a `(item, warehouse)` pair whose ledger holds a `RESERVE` and the `TRANSFER_OUT` that consumed it
- **WHEN** its balance is recomputed from `stock_txn` alone
- **THEN** the recomputed `qty_reserved` is 0 and equals the stored `qty_reserved`

#### Scenario: A balance row is created on first movement

- **GIVEN** an item that has never moved in a warehouse
- **WHEN** its first `stock_txn` row is written
- **THEN** a `stock_balance` row for that pair is created in the same transaction

### Requirement: Stock Reserve, Issue, and Release Lifecycle

The system SHALL apply reserve-then-actual to stock exactly as it does to budget (invariant 4): a document whose type `post_action` is `ISSUE_STOCK` or `TRANSFER_STOCK` SHALL `RESERVE` its stock at submit, convert that reservation to `ISSUE` (or to the paired transfer rows) on full approval, and `RELEASE` it on reject or cancel. Availability SHALL be enforced **at submit**, when the reservation is taken, not at approval, so a shortage is visible to the requester rather than surfacing at the last approval step. Before checking availability the system SHALL aggregate the document's lines by `(item_id, warehouse_id)`, so two lines naming the same item in the same warehouse are checked against their combined quantity. If any pair is short, the entire submit SHALL be rejected and no `RESERVE` row SHALL be written for any line. Reject or cancel SHALL ALWAYS release reserved stock (invariant 5), and the release SHALL be idempotent — a document holding no live reservation SHALL write no `RELEASE` row. A document whose reservation has already been consumed by an `ISSUE` or by a `TRANSFER_OUT` SHALL be treated as holding nothing, so the outstanding hold a release acts on and the `qty_reserved` a balance carries are derived from the same set of discharging types — a release that disagreed with the balance would drive `qty_reserved` negative on a document that owes nothing.

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

#### Scenario: A finished transfer has nothing left to release

- **GIVEN** a transfer document that has been fully approved and whose `TRANSFER_OUT` is recorded
- **WHEN** the auto-release path runs for that document
- **THEN** it computes zero outstanding, writes no `RELEASE` row, and `qty_reserved` does not go negative
