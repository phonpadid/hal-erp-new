## ADDED Requirements

### Requirement: Open Payables Are Readable

The system SHALL expose a read-only, company-scoped list of open payables, gated by `GL_VIEW`: the
documents that were accrued at approval and whose payment has not posted. Each SHALL carry its
vendor, the amount credited to the payable, the invoice date (the accrual's `entry_date`) and a due
date derived as that date plus `vendor.payment_term_days`. The read MUST NOT mutate any ledger.

Open payables SHALL be derived, not stored: an accrual entry exists and no settlement entry does for
the same source. `payment.document_id` is unique — a document is paid exactly once — so a payable is
open or it is not, and there is no partial state a stored subledger would be needed to hold. A
derived read cannot drift from the journal because it is read from it.

A payable raised against `CLAIM_PAYABLE` rather than `ACCOUNTS_PAYABLE` SHALL be excluded: it is
owed to a person, not a vendor, and it is cleared by a recorded settlement rather than by a payment.

#### Scenario: An approved, unpaid purchase is listed

- **GIVEN** a document of a vendor type that accrued at approval and has not been paid
- **WHEN** the open-payables read runs for its company
- **THEN** it is listed with its vendor, the accrued amount, its invoice date, and a due date that
  many days later, where the days come from that vendor's `payment_term_days`

#### Scenario: A paid purchase drops off

- **WHEN** the payment for an accrued document posts
- **THEN** that document no longer appears on the read

#### Scenario: The read is company-scoped and permission-gated

- **WHEN** a `GL_VIEW` user in company A runs the read
- **THEN** only company A's open payables are returned, and a request without `GL_VIEW` is rejected
  with 403

#### Scenario: A claim is not a payable

- **GIVEN** an accrued document with no vendor, whose payable is `CLAIM_PAYABLE`
- **WHEN** the read runs
- **THEN** it is not listed

## MODIFIED Requirements

### Requirement: Config-Driven System Account Roles

The system SHALL resolve the cash-clearing, FX, tax, inventory, and payable accounts through an `account_role`
map from `(company, role)` to an `account`, with roles `CASH_CLEARING`, `FX_GAIN`, `FX_LOSS`,
`VAT_INPUT`, `WHT_PAYABLE`, `INVENTORY`, `GRNI`, `INVENTORY_ADJUSTMENT`, `INVENTORY_IN_TRANSIT`,
`CLAIM_PAYABLE`, and `ACCOUNTS_PAYABLE` — never by a hardcoded account code (invariant 7). A role that
is unmapped, inactive, or in another company SHALL make the posting a logged failure, not a crash.

`VAT_INPUT` is the recoverable input-VAT account, debited for a document's `base_tax_total` when it
is non-zero. `WHT_PAYABLE` is the withholding tax withheld from a vendor and owed to the tax
authority, credited for `payment.wht_amount` when it is non-zero. Both are named by
`Posting on Payment Settlement` and both are required for any company whose purchases bear VAT or
whose payments withhold tax — a company that maps neither cannot post such a payment at all, and
by the rule above it will fail silently.

`INVENTORY` is the company's inventory asset account, debited when stock is capitalized and
credited when it is consumed. `GRNI` (goods received not invoiced) is the liability that stands
between capitalizing goods at receipt and paying for them; without it a receipt entry has no
credit side and cannot balance. `INVENTORY_ADJUSTMENT` absorbs the gain or loss of a stock
adjustment. `INVENTORY_IN_TRANSIT` is reserved for multi-step transfers and SHALL be resolvable
but is unused by the current transfer posting, which moves stock in a single step. `CLAIM_PAYABLE`
is the liability that stands between an approved compensation and the money leaving — the same
shape as `GRNI`, for an obligation that arises at approval rather than at receipt.

`ACCOUNTS_PAYABLE` is trade payable: what the company owes a vendor between accepting an invoice and
paying it. It is the same shape again, for the obligation with the most volume — and the one that,
before it existed, was recognised only when the cash moved.

#### Scenario: Roles resolve to the company's mapped accounts

- **WHEN** the engine needs the cash-clearing, FX, tax, inventory, or payable account for a company
- **THEN** it uses the account mapped to that role for that company

#### Scenario: A missing role mapping fails the posting only

- **WHEN** a required role has no active mapping for the company
- **THEN** the posting is skipped and logged, and the payment, stock, or approval flow is unaffected

#### Scenario: Inventory roles are company-scoped like every other role

- **GIVEN** company A maps `INVENTORY` and company B does not
- **WHEN** a stock movement is approved in company B
- **THEN** the movement commits, its posting is skipped and logged, and company A's mapping is not used

#### Scenario: A VAT-bearing payment needs the VAT role mapped

- **GIVEN** a company with no account mapped to `VAT_INPUT`
- **WHEN** a settled document carrying a non-zero `base_tax_total` is posted
- **THEN** the posting is skipped and logged, and the payment is unaffected

#### Scenario: An accruing purchase needs the payable role mapped

- **GIVEN** a company with no account mapped to `ACCOUNTS_PAYABLE`
- **WHEN** a document of a vendor type that accrues reaches full approval
- **THEN** the document stays approved with its budget cut, no entry is written, and the failure is
  recorded as an undelivered posting rather than only logged

### Requirement: Posting on Approval for Types That Accrue

A document type MAY declare that its expense is recognised at approval. When such a document reaches full approval, the system SHALL post one balanced entry that debits the expense accounts named by the document's `budget_txn` ACTUAL rows, aggregated per account at the locked basis, and credits a payable for the document's company. The posting SHALL run after the approval transaction commits, so a posting failure SHALL be logged and SHALL leave the approval and its budget effect standing. A document of a type that does not declare it SHALL post nothing at approval, exactly as today.

**Which payable** SHALL be derived from the document, not configured: a document carrying a `vendor_id` credits `ACCOUNTS_PAYABLE`, and one without credits `CLAIM_PAYABLE`. An approved obligation to a vendor is a trade payable and the document already says so; a second configuration field would only add a way to record it wrongly.

**Which ACTUAL rows** SHALL depend on the same distinction. A vendor document SHALL take the rows of the settlement it charges — its own, or, when the budget hold belongs to a document further up its `ref_document_id` chain, the nearest ancestor carrying ACTUAL rows — the same walk `Posting on Payment Settlement` makes. A document without a vendor SHALL keep using its own rows: a compensation has no reference chain, and its accrual belongs to the document that was approved. Without the walk a chained purchase finds no rows, accrues nothing, and its payment silently falls back to recognising the expense at payment — the behaviour this requirement exists to replace, failing quietly rather than loudly.

**Input VAT and the stock split** SHALL be posted here rather than at payment, when the document carries a vendor. The entry SHALL debit `VAT_INPUT` for the document's `base_tax_total` when it is non-zero, because the tax point of input VAT is the invoice and not the cash. The stock-tracked portion of the charged amount SHALL debit `GRNI` instead of the expense account, under the rules in `Settling a Stock Purchase Clears GRNI Rather Than Expense`: goods capitalized at receipt are turned into a vendor debt by the invoice, not by the payment. The payable SHALL therefore be credited gross of tax — the same `base_locked` the payment will clear — because that is what is owed.

#### Scenario: An approved claim is recognised

- **GIVEN** a document type that accrues at approval, and a document of that type with no vendor that cut budget against one expense account
- **WHEN** the document reaches full approval
- **THEN** a journal entry exists debiting that expense account and crediting the company's `CLAIM_PAYABLE` account for the same amount

#### Scenario: An approved purchase raises a trade payable

- **GIVEN** a document type that accrues at approval and requires a vendor, and a document of that type carrying a vendor that cut budget against one expense account
- **WHEN** the document reaches full approval
- **THEN** a journal entry exists debiting that expense account and crediting `ACCOUNTS_PAYABLE`

#### Scenario: A chained purchase accrues from its ancestor's cuts

- **GIVEN** a purchase approved as a `PROC` that reserved the budget and a `DISB` referencing it that carries no `budget_txn` ACTUAL of its own
- **WHEN** the `DISB` reaches full approval
- **THEN** the accrual debits the expense accounts named by the ancestor's ACTUAL rows and credits `ACCOUNTS_PAYABLE`, rather than being skipped

#### Scenario: Input VAT is recognised with the invoice

- **GIVEN** an accruing purchase whose expense is 100,000 and whose `base_tax_total` is 7,000
- **WHEN** it reaches full approval
- **THEN** the entry debits expense 100,000 and `VAT_INPUT` 7,000 and credits `ACCOUNTS_PAYABLE` 107,000, and the payment posts no VAT line

#### Scenario: A stock purchase accrues against GRNI

- **GIVEN** an accruing purchase whose only line is a stock-tracked item
- **WHEN** it reaches full approval
- **THEN** the entry debits `GRNI` rather than the expense account, and credits `ACCOUNTS_PAYABLE`

#### Scenario: The debit follows the budget cuts

- **GIVEN** an approved document whose lines cut two different budgets
- **WHEN** the accrual is posted
- **THEN** it carries one debit line per expense account, each for that account's total, and one credit line for the sum

#### Scenario: Types that do not declare it are unaffected

- **WHEN** a document of a type that does not accrue at approval reaches full approval
- **THEN** no journal entry is posted at approval, and any posting on payment settlement happens exactly as before

#### Scenario: A failed posting does not undo the approval

- **GIVEN** a company with no account mapped to the payable the document needs
- **WHEN** a document that accrues reaches full approval
- **THEN** the document stays approved with its budget cut, no entry is written, and the failure is recorded

#### Scenario: The accrual is posted once

- **WHEN** the approval outcome for the same document is delivered twice
- **THEN** exactly one accrual entry exists for it

#### Scenario: A document that cut no budget accrues nothing

- **GIVEN** a document of an accruing type that wrote no `budget_txn` ACTUAL row
- **WHEN** it reaches full approval
- **THEN** no entry is posted, because there is no charged amount to recognise

### Requirement: Posting on Payment Settlement

The system SHALL post one balanced journal entry per settled document when `payment.settled` occurs.

**When the document was accrued at approval**, the entry SHALL debit the payable that accrual
credited, for the amount it credited, credit the `WHT_PAYABLE` account for `payment.wht_amount` when
it is non-zero, credit the cash-clearing account for the actual base amount **net of
`payment.wht_amount`**, and post the FX difference (`payment.fx_delta`) to the realized FX gain or
loss account. It SHALL NOT debit any expense account, `VAT_INPUT`, or `GRNI`: all three were posted
with the accrual, and posting them again would recognise the same purchase twice. The payable SHALL
be cleared at the amount it was raised at, so the entire rate difference lands in FX by construction
(`payable + fx_delta = base_actual = cash + wht`).

**When it was not**, the entry SHALL debit the expense account(s) of the budget(s) the document
charged (via `budget.account_id`) at the locked base amount, debit the `VAT_INPUT` account for the
document's input-VAT total (`document.base_tax_total`) when it is non-zero, credit `WHT_PAYABLE` and
cash-clearing as above, and post the FX difference the same way. This is the behaviour every
document approved before its type began accruing keeps for the rest of its life, which is what makes
the change incremental rather than a migration.

In both cases the expense or payable side SHALL be taken from the `budget_txn` ACTUAL rows of the
settlement — the paid document's own, or, when the settled hold belongs to a document further up its
`ref_document_id` chain, the nearest ancestor carrying ACTUAL rows — so that a chain-settled
disbursement posts the same entry a self-settling one does. The posting SHALL run after the payment
transaction has committed and SHALL NOT write any `budget_txn` (invariant 6 — FX goes to accounting,
not the budget). Every entry SHALL remain balanced (Σdebit = Σcredit).

#### Scenario: Settlement with no FX difference

- **GIVEN** a settled disbursement with `base_locked` = `base_actual` = 100000 charged to one
  budget whose account is an expense account, with no VAT and no WHT, and no accrual
- **WHEN** `payment.settled` is handled
- **THEN** a balanced entry is posted: debit the expense account 100000 and credit the
  cash-clearing account 100000, with no FX, VAT, or WHT line

#### Scenario: Settling an accrued purchase clears its payable

- **GIVEN** a document accrued at approval for 107000 against `ACCOUNTS_PAYABLE`, settled with
  `base_locked` = `base_actual` = 107000 and no WHT
- **WHEN** `payment.settled` is handled
- **THEN** the entry debits `ACCOUNTS_PAYABLE` 107000 and credits cash-clearing 107000, and no
  expense, `VAT_INPUT` or `GRNI` line is written

#### Scenario: An accrued purchase paid at a different rate

- **GIVEN** a document accrued at approval for 100000, settled with `base_locked` 100000 and
  `base_actual` 102000 (`fx_delta` +2000, kind LOSS)
- **WHEN** `payment.settled` is handled
- **THEN** the entry debits `ACCOUNTS_PAYABLE` 100000 and the FX-loss account 2000, and credits
  cash-clearing 102000 — the payable clears at the rate it was raised at

#### Scenario: An accrued purchase paid with withholding

- **GIVEN** a document accrued at approval for 107000, settled with `base_actual` 107000 and
  `payment.wht_amount` 3000
- **WHEN** `payment.settled` is handled
- **THEN** the entry debits `ACCOUNTS_PAYABLE` 107000 and credits `WHT_PAYABLE` 3000 and
  cash-clearing 104000

#### Scenario: Settlement with an FX loss

- **GIVEN** a settled disbursement with no accrual, `base_locked` 100000 and `base_actual` 102000
  (`fx_delta` +2000, kind LOSS), no VAT, no WHT
- **WHEN** `payment.settled` is handled
- **THEN** the entry debits the expense account 100000 and the FX-loss account 2000, and
  credits the cash-clearing account 102000 (Σdebit = Σcredit = 102000)

#### Scenario: Settlement carrying input VAT and WHT

- **GIVEN** a settled disbursement with no accrual, expense net 100000, input VAT 7000
  (`base_locked` = `base_actual` = 107000, `base_tax_total` 7000) and `payment.wht_amount` 3000
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

### Requirement: Settling a Stock Purchase Clears GRNI Rather Than Expense

The system SHALL post the stock-tracked portion of a purchase to the `GRNI` account instead of to
the budget's expense account. Goods that were capitalized into `INVENTORY` when they were received
are expensed once, when they are issued; charging expense again would put the same purchase through
profit and loss twice. The stock-tracked portion SHALL be computed from the document's own lines
whose `item.is_stock_tracked` is true, at the same `budget_base_line_amount` basis the budget was
cut on, so the two figures always agree, and it SHALL NOT exceed what was actually cut on that
account. Lines whose item is not stock-tracked SHALL continue to debit the budget's expense account.

The split SHALL be applied **wherever the expense side of that purchase is posted**: at the approval
accrual for a document whose type accrues, and at the payment settlement for one whose type does
not. It is a property of what was bought, not of when the entry happens.

The account a stock-tracked line belongs to SHALL be resolved from the document whose `budget_txn`
ACTUAL rows are being posted — the document's own, or the reference-chain ancestor the expense side
was already taken from — matched by `line_no`, whenever the posting document's own lines carry no
budget. A settlement type is ordinarily not budget-controlled, so its lines are stamped with no
budget and only the charged document's lines carry one. Resolving from that same document is what
makes the stock figure and the cut agree by construction rather than by coincidence: they are read
from one source, not from two that currently match. Without this the portion resolves to nothing on
every chained purchase and the whole amount debits expense — the outcome this requirement exists to
prevent, in the shape most purchases actually have.

#### Scenario: A stock purchase settles against GRNI

- **GIVEN** a settled document of a non-accruing type whose only line is a stock-tracked item cut
  against one budget
- **WHEN** the payment is posted
- **THEN** the entry debits `GRNI` for that line's base amount and does not debit the budget's
  expense account

#### Scenario: An accruing stock purchase clears GRNI at approval

- **GIVEN** a document of an accruing vendor type whose only line is a stock-tracked item
- **WHEN** it reaches full approval
- **THEN** the accrual debits `GRNI` and credits `ACCOUNTS_PAYABLE`, and the later payment debits
  the payable rather than `GRNI` a second time

#### Scenario: A chain-settled stock purchase also clears GRNI

- **GIVEN** a stock purchase approved as a `PR` that reserved the budget, paid through a `DISB`
  that references it and whose own lines carry no budget
- **WHEN** the payment is posted
- **THEN** the entry debits `GRNI`, not the expense account — the stock-tracked portion is resolved
  from the charged document's line at the same `line_no`

#### Scenario: A mixed document splits between GRNI and expense

- **GIVEN** a document with one stock-tracked line and one untracked line on the same budget
- **WHEN** its expense side is posted
- **THEN** `GRNI` is debited for the stock-tracked line's base amount and the expense account is
  debited for the remainder

#### Scenario: A document with no stock lines is unaffected

- **WHEN** a document carries no stock-tracked line
- **THEN** the entry debits the budget's expense account exactly as it did before

#### Scenario: The stock portion never exceeds what was cut

- **GIVEN** a document whose stock-tracked lines total more than the amount cut against their
  account
- **WHEN** its expense side is posted
- **THEN** `GRNI` is debited only up to the amount cut, and no expense line is written for a
  negative remainder
