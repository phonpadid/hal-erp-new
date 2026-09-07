## ADDED Requirements

### Requirement: The Expense Side Is Taken From The Account Each Line Named

The expense side of a settlement and of an approval accrual SHALL be keyed by the account stamped on
each line (`document_line.account_id`), not by the account on the budget the line charged. One budget
MAY therefore post to several accounts, and several budgets MAY still post to one.

Each `budget_txn` ACTUAL row SHALL be apportioned across the lines charging that budget, pro rata by
`budget_base_line_amount` — the basis the budget was reserved and settled on, so the weights and the
amount being split are the same number. Rounding SHALL be to the currency's scale, and the residue
SHALL be given to the largest line, so the apportioned shares sum to the ACTUAL amount exactly and
the result does not depend on the order lines are read in.

Where the lines charging a budget carry no `budget_base_line_amount` at all, the whole ACTUAL amount
SHALL be posted to that budget's own account, which is the case a spend-history import produces.

Every entry SHALL remain balanced, and its expense side SHALL total exactly what the budget was cut
by — this changes which accounts are debited, never how much.

#### Scenario: One budget posting to two accounts

- **GIVEN** a settled document charging one budget through two lines of 600 and 400 at the budget
  basis, stamped with accounts `5210` and `5300`, settled ACTUAL 1000
- **WHEN** `payment.settled` is handled
- **THEN** the entry debits `5210` 600 and `5300` 400, and remains balanced

#### Scenario: Two budgets sharing one account still post once

- **GIVEN** a settled document charging two budgets through two lines both stamped with account
  `5210`, ACTUAL 300 and 700
- **WHEN** `payment.settled` is handled
- **THEN** the entry carries one debit of 1000 on `5210`

#### Scenario: A partial settlement is apportioned pro rata

- **GIVEN** a budget reserved through lines of 600 and 400, settled with ACTUAL 500 and the
  remainder released
- **WHEN** the settlement is posted
- **THEN** the accounts are debited 300 and 200, totalling the ACTUAL amount

#### Scenario: The residue of a rounding leaves the total exact

- **GIVEN** a budget with ACTUAL 100 apportioned across three equal lines in a currency with no
  minor unit
- **WHEN** the settlement is posted
- **THEN** the debits sum to exactly 100, with the odd unit on the largest line

#### Scenario: Lines carrying no budget basis post to the budget's account

- **GIVEN** an imported spend whose lines carry no `budget_base_line_amount`
- **WHEN** it is posted
- **THEN** the whole ACTUAL amount debits the budget's own account

### Requirement: A Line With No Stamped Account Posts To Its Budget's

Where a line carries no `document_line.account_id`, the posting SHALL take that line's account from
the budget it charged, exactly as it did before the stamp existed.

This is not a temporary migration step. Every document submitted before this change has no stamp;
`spend-import` writes lines directly; and a chain settled through an ancestor reads that ancestor's
lines, which may be older than the stamp. A null therefore means "post the old way", permanently.

Only when a line has neither a stamped account nor a budget account SHALL the posting fail, with the
message and the recorded `blocked_by_budget_id` cause it already carries.

#### Scenario: A document submitted before the stamp posts unchanged

- **GIVEN** a settled document whose lines carry no `account_id` and whose budget names account
  `5210`
- **WHEN** it is posted
- **THEN** the entry debits `5210` exactly as it did before this change

#### Scenario: Stamped and unstamped lines on one document

- **GIVEN** a document with one line stamped `5300` and one carrying no stamp, charging a budget
  whose account is `5210`
- **WHEN** it is posted
- **THEN** the stamped line's share debits `5300` and the unstamped line's share debits `5210`

#### Scenario: Neither account is a failure, not a skip

- **GIVEN** a line with no stamped account charging a budget with no `account_id`
- **WHEN** it is posted
- **THEN** the attempt is `FAILED`, naming the budget and the document, and records that budget in
  `blocked_by_budget_id`

## MODIFIED Requirements

### Requirement: Settling a Stock Purchase Clears GRNI Rather Than Expense

Goods already capitalized into inventory SHALL NOT be expensed again at settlement. A stock-tracked
line was debited to inventory when it was received, so its share of the document SHALL clear `GRNI`
rather than an expense account; expense is charged once, when the goods are issued.

The share SHALL be taken per **line account** — the account stamped on the line, falling back to its
budget's — using the same `budget_base_line_amount` basis the budget was cut on, so the stock split
and the expense apportionment always agree by construction. It was previously keyed by the budget's
account, which cannot express a budget whose stock-tracked and expensed lines post to different
accounts.

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

- **GIVEN** a settled purchase with one stock-tracked line and one that is not, charging one budget
- **WHEN** it is posted
- **THEN** the stock-tracked line's share debits `GRNI` and the other line's share debits its own
  stamped account

#### Scenario: A document with no stock lines is unaffected

- **WHEN** a document carries no stock-tracked line
- **THEN** the entry debits the budget's expense account exactly as it did before

#### Scenario: The stock portion never exceeds what was cut

- **GIVEN** a document whose stock-tracked lines total more than the amount cut against their
  account
- **WHEN** its expense side is posted
- **THEN** `GRNI` is debited only up to the amount cut, and no expense line is written for a
  negative remainder

