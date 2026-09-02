## MODIFIED Requirements

### Requirement: Settling a Stock Purchase Clears GRNI Rather Than Expense

The system SHALL post the stock-tracked portion of a settled document to the `GRNI` account
instead of to the budget's expense account. Goods that were capitalized into `INVENTORY` when they
were received are expensed once, when they are issued; charging expense again at payment would put
the same purchase through profit and loss twice. The stock-tracked portion SHALL be computed from
the settled document's own lines whose `item.is_stock_tracked` is true, at the same
`budget_base_line_amount` basis the budget was cut on, so the two figures always agree, and it
SHALL NOT exceed what was actually cut on that account. Lines whose item is not stock-tracked SHALL
continue to debit the budget's expense account exactly as before.

The account a stock-tracked line belongs to SHALL be resolved from the document whose `budget_txn`
ACTUAL rows the settlement charged — the paying document's own, or the reference-chain ancestor the
expense side was already taken from — matched by `line_no`, whenever the paying document's own lines
carry no budget. A settlement type is ordinarily not budget-controlled, so its lines are stamped
with no budget and only the charged document's lines carry one. Resolving from that same document
is what makes the stock figure and the cut agree by construction rather than by coincidence: they
are read from one source, not from two that currently match. Without this the portion resolves to
nothing on every chained purchase and the whole amount debits expense — the outcome this requirement
exists to prevent, in the shape most purchases actually have.

#### Scenario: A stock purchase settles against GRNI

- **GIVEN** a settled document whose only line is a stock-tracked item cut against one budget
- **WHEN** the payment is posted
- **THEN** the entry debits `GRNI` for that line's base amount and does not debit the budget's
  expense account

#### Scenario: A chain-settled stock purchase also clears GRNI

- **GIVEN** a stock purchase approved as a `PR` that reserved the budget, paid through a `DISB`
  that references it and whose own lines carry no budget
- **WHEN** the payment is posted
- **THEN** the entry debits `GRNI`, not the expense account — the stock-tracked portion is resolved
  from the charged document's line at the same `line_no`

#### Scenario: A mixed document splits between GRNI and expense

- **GIVEN** a settled document with one stock-tracked line and one untracked line on the same budget
- **WHEN** the payment is posted
- **THEN** `GRNI` is debited for the stock-tracked line's base amount and the expense account is
  debited for the remainder

#### Scenario: A document with no stock lines is unaffected

- **WHEN** a settled document carries no stock-tracked line
- **THEN** the entry debits the budget's expense account exactly as it did before

#### Scenario: The stock portion never exceeds what was cut

- **GIVEN** a settled document whose stock-tracked lines total more than the amount cut against
  their account
- **WHEN** the payment is posted
- **THEN** `GRNI` is debited only up to the amount cut, and no expense line is written for a
  negative remainder
