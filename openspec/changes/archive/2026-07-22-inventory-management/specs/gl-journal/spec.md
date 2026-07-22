## MODIFIED Requirements

### Requirement: Config-Driven System Account Roles

The system SHALL resolve the cash-clearing, FX, and inventory accounts through an `account_role`
map from `(company, role)` to an `account`, with roles `CASH_CLEARING`, `FX_GAIN`, `FX_LOSS`,
`INVENTORY`, `GRNI`, `INVENTORY_ADJUSTMENT`, and `INVENTORY_IN_TRANSIT` — never by a hardcoded
account code (invariant 7). A role that is unmapped, inactive, or in another company SHALL make the
posting a logged failure, not a crash.

`INVENTORY` is the company's inventory asset account, debited when stock is capitalized and
credited when it is consumed. `GRNI` (goods received not invoiced) is the liability that stands
between capitalizing goods at receipt and paying for them; without it a receipt entry has no
credit side and cannot balance. `INVENTORY_ADJUSTMENT` absorbs the gain or loss of a stock
adjustment. `INVENTORY_IN_TRANSIT` is reserved for multi-step transfers and SHALL be resolvable
but is unused by the current transfer posting, which moves stock in a single step.

#### Scenario: Roles resolve to the company's mapped accounts

- **WHEN** the engine needs the cash-clearing, FX, or inventory account for a company
- **THEN** it uses the account mapped to that role for that company

#### Scenario: A missing role mapping fails the posting only

- **WHEN** a required role has no active mapping for the company
- **THEN** the posting is skipped and logged, and the payment or stock flow is unaffected

#### Scenario: Inventory roles are company-scoped like every other role

- **GIVEN** company A maps `INVENTORY` and company B does not
- **WHEN** a stock movement is approved in company B
- **THEN** the movement commits, its posting is skipped and logged, and company A's mapping is not used

## ADDED Requirements

### Requirement: Settling a Stock Purchase Clears GRNI Rather Than Expense

The system SHALL post the stock-tracked portion of a settled document to the `GRNI` account
instead of to the budget's expense account. Goods that were capitalized into `INVENTORY` when they
were received are expensed once, when they are issued; charging expense again at payment would put
the same purchase through profit and loss twice. The stock-tracked portion SHALL be computed from
the settled document's own lines whose `item.is_stock_tracked` is true, at the same
`budget_base_line_amount` basis the budget was cut on, so the two figures always agree, and it
SHALL NOT exceed what was actually cut on that account. Lines whose item is not stock-tracked SHALL
continue to debit the budget's expense account exactly as before.

#### Scenario: A stock purchase settles against GRNI

- **GIVEN** a settled document whose only line is a stock-tracked item cut against one budget
- **WHEN** the payment is posted
- **THEN** the entry debits `GRNI` for that line's base amount and does not debit the budget's
  expense account

#### Scenario: A mixed document splits between GRNI and expense

- **GIVEN** a settled document with one stock-tracked line and one untracked line on the same budget
- **WHEN** the payment is posted
- **THEN** `GRNI` is debited for the stock-tracked line's base amount and the expense account is
  debited for the remainder

#### Scenario: A document with no stock lines is unaffected

- **WHEN** a settled document carries no stock-tracked line
- **THEN** the entry debits the budget's expense account exactly as it did before

### Requirement: Posting on Stock Movement

The system SHALL treat an approved stock movement as a posting source, producing a balanced
`journal_entry` with `source_type` of `STOCK_TXN` and the movement's id as `source_id`, so the
existing idempotency guarantee on `(company_id, source_type, source_id)` applies unchanged and a
retry never double-posts. Entry amounts SHALL be derived from the movement's `qty` and `unit_cost`,
rounded to the currency's `decimal_places`, with any rounding residual absorbed into the inventory
line so `SUM(debit)` equals `SUM(credit)`. Movements that carry no value — `RESERVE` and `RELEASE`
— SHALL NOT post. A transfer between two warehouses of one company SHALL NOT post either: both
ends resolve to the same `INVENTORY` account, so the entry would net to zero and say nothing the
stock ledger has not already recorded.

#### Scenario: A stock movement posts a balanced entry

- **WHEN** a stock movement of 5 units at unit cost 110 is approved
- **THEN** a `journal_entry` exists for it whose debits and credits both total 550

#### Scenario: Retrying a stock posting does not double-post

- **WHEN** the posting for the same `stock_txn` id is attempted a second time
- **THEN** exactly one `journal_entry` exists for that source

#### Scenario: Reservations produce no entry

- **WHEN** a `RESERVE` or `RELEASE` row is written
- **THEN** no `journal_entry` is created for it

#### Scenario: A receipt capitalizes the asset against GRNI

- **WHEN** 10 units are received at a unit cost of 120
- **THEN** a balanced entry debits `INVENTORY` 1200 and credits `GRNI` 1200

#### Scenario: An intra-company transfer posts nothing

- **WHEN** stock moves between two warehouses of the same company
- **THEN** no `journal_entry` is created, because both ends resolve to the same account
