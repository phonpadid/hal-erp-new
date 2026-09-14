## MODIFIED Requirements

### Requirement: The Expense Side Is Taken From The Account Each Line Named

The expense side of a settlement and of an approval accrual SHALL be keyed by the account stamped on
each line (`document_line.account_id`), not by the account on the budget the line charged. One budget
MAY therefore post to several accounts, and several budgets MAY still post to one.

The line whose stamp is read SHALL be, in this order: (1) the line of the document being posted
with the same `line_no` as the charged line, where that line carries an `account_id`; (2) otherwise
the charged document's own line — the line of the document that holds the `budget_txn` ACTUAL row,
which on a chain (PR → PO → DISB) is the reserving ancestor; (3) otherwise that line's budget's
`account_id`. For a document that is not chained, (1) and (2) are the same line and the rule is
unchanged. On a chain the document being posted is the one accounting last saw and signed, and a
re-code made at its approval step (approval-workflow: *A Step May Allow Its Approver To Re-Code A
Line's Account*) reaches the ledger through (1). This is the same own-line-first, ancestor-second
order the GRNI split already applies, so the two sides of a stock purchase agree by construction.

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

#### Scenario: A re-coded line on a chained disbursement reaches the ledger

- **GIVEN** a PR whose line 1 is stamped `612.06` and holds the ACTUAL row, and a DISB referencing
  it whose line 1 was re-coded to `615.01` at its accounting step
- **WHEN** the DISB's accrual or settlement is posted
- **THEN** line 1's share debits `615.01`

#### Scenario: A chained document's own stamp outranks its ancestor's

- **GIVEN** a PR whose line 1 is stamped `612.06` and a DISB referencing it whose line 1 was
  stamped `612.07` at its own submit, with no re-code
- **WHEN** the DISB is posted
- **THEN** line 1's share debits `612.07`

#### Scenario: A chained document's unstamped line falls back to the ancestor's

- **GIVEN** a PR whose line 1 is stamped `612.06` and a DISB referencing it whose line 1 carries no
  `account_id`
- **WHEN** the DISB is posted
- **THEN** line 1's share debits `612.06`

#### Scenario: A non-chained document posts exactly as before

- **GIVEN** a document holding its own ACTUAL rows, one line re-coded from `5210` to `5300`
  mid-route and one line left at `5210`
- **WHEN** it is posted
- **THEN** the re-coded line's share debits `5300` and the other's `5210`, and the entry balances
