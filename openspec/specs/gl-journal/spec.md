# GL Journal Specification

## Purpose
An append-only, double-entry general ledger (`journal_entry` / `journal_line`) and the posting
engine that turns disbursement settlements into balanced journal entries against the chart of
accounts. System accounts (cash clearing, FX gain/loss) are resolved by role, not by hardcoded
code. This capability produces the balanced journal that future accounting slices (periods,
subledgers, financial statements) build on; it does not change the budget ledger or the payment
flow.

## Requirements

### Requirement: Append-Only Double-Entry General Ledger

The system SHALL record general-ledger postings as a `journal_entry` header and its
`journal_line` rows, and MUST NOT update or delete either once written — corrections are new
reversing entries (append-only, like `budget_txn`). Each `journal_line` SHALL carry a `debit`
and a `credit` amount (decimal, company base currency) with exactly one non-zero per line, and
reference an `account`. Every `journal_entry` and `journal_line` SHALL be scoped to one company
(invariant 1).

#### Scenario: Entries and lines cannot be mutated

- **WHEN** any code attempts to UPDATE or DELETE a `journal_entry` or `journal_line` row
- **THEN** the operation is rejected (append-only), and a correction must be a new entry

#### Scenario: Each line is one-sided

- **WHEN** a journal line is written
- **THEN** exactly one of its `debit` / `credit` is non-zero and it references an account in
  the same company

### Requirement: Balanced Entry Invariant

Every `journal_entry` SHALL be balanced: the sum of its lines' `debit` amounts MUST equal the
sum of their `credit` amounts, in the company base currency. The system MUST reject an entry
whose sides differ by any minor unit before it is persisted.

#### Scenario: A balanced entry is accepted

- **WHEN** an entry's total debits equal its total credits
- **THEN** the entry and its lines are persisted

#### Scenario: An unbalanced entry is rejected

- **WHEN** an entry's total debits do not equal its total credits
- **THEN** the entry is rejected and no line is written

### Requirement: Posting on Payment Settlement

The system SHALL post one balanced journal entry per settled document when `payment.settled`
occurs. The entry SHALL debit the expense account(s) of the budget(s) the document charged (via
`budget.account_id`) at the locked base amount, debit the `VAT_INPUT` account for the document's
input-VAT total (`document.base_tax_total`) when it is non-zero, credit the `WHT_PAYABLE` account
for `payment.wht_amount` when it is non-zero, credit the cash-clearing account for the actual base
amount **net of `payment.wht_amount`**, and post the FX difference (`payment.fx_delta`) to the
realized FX gain or loss account. The expense side SHALL be taken from the `budget_txn` ACTUAL rows
of the settlement — the paid document's own, or, when the settled hold belongs to a document
further up its `ref_document_id` chain, the nearest ancestor carrying ACTUAL rows — so that a
chain-settled disbursement posts the same entry a self-settling one does. The posting SHALL run
after the payment transaction has committed and SHALL NOT write any `budget_txn` (invariant 6 — FX
goes to accounting, not the budget). Every entry SHALL remain balanced (Σdebit = Σcredit).

#### Scenario: Settlement with no FX difference

- **GIVEN** a settled disbursement with `base_locked` = `base_actual` = 100000 charged to one
  budget whose account is an expense account, with no VAT and no WHT
- **WHEN** `payment.settled` is handled
- **THEN** a balanced entry is posted: debit the expense account 100000 and credit the
  cash-clearing account 100000, with no FX, VAT, or WHT line

#### Scenario: Settlement with an FX loss

- **GIVEN** a settled disbursement with `base_locked` 100000 and `base_actual` 102000
  (`fx_delta` +2000, kind LOSS), no VAT, no WHT
- **WHEN** `payment.settled` is handled
- **THEN** the entry debits the expense account 100000 and the FX-loss account 2000, and
  credits the cash-clearing account 102000 (Σdebit = Σcredit = 102000)

#### Scenario: Settlement carrying input VAT and WHT

- **GIVEN** a settled disbursement with expense net 100000, input VAT 7000 (`base_locked` =
  `base_actual` = 107000, `base_tax_total` 7000) and `payment.wht_amount` 3000
- **WHEN** `payment.settled` is handled
- **THEN** the entry debits expense 100000 and VAT_INPUT 7000 and credits cash-clearing 104000
  (107000 − 3000) and WHT_PAYABLE 3000 (Σdebit = Σcredit = 107000)

#### Scenario: Settlement whose budget hold belongs to a predecessor

- **GIVEN** a paid disbursement that carries no `budget_txn` ACTUAL of its own because the chain's
  hold was reserved and settled on its predecessor
- **WHEN** `payment.settled` is handled
- **THEN** the expense side is taken from the predecessor's ACTUAL rows and a balanced entry is
  posted, rather than the posting being skipped

#### Scenario: Posting never rolls back the payment

- **WHEN** the posting fails (e.g. a system account is not mapped)
- **THEN** the already-committed payment is unaffected, the failure is logged, and the posting
  can be retried

### Requirement: Idempotent Posting

Each `journal_entry` SHALL carry a source key (`source_type`, `source_id`) unique per company.
The system MUST NOT post more than one entry for the same source; a repeated or retried
`payment.settled` for an already-posted source SHALL be a no-op.

#### Scenario: A retried event does not double-post

- **GIVEN** a document whose settlement has already produced a journal entry
- **WHEN** `payment.settled` fires again for that same document
- **THEN** no second entry is written

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

### Requirement: Authorized, Company-Scoped Journal Read

The system SHALL expose a read-only journal query (entries with their balanced lines) gated by
`GL_VIEW`, scoped to the caller's active company, and it MUST NOT mutate any ledger. There is
no create/update/delete endpoint for journal entries — they are produced only by the posting
engine.

#### Scenario: Reading the journal is permission-gated

- **WHEN** a request without `GL_VIEW` queries the journal
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: The journal read is company-scoped and read-only

- **WHEN** a `GL_VIEW` user in company A reads the journal
- **THEN** only company A's entries are returned and nothing is written

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
