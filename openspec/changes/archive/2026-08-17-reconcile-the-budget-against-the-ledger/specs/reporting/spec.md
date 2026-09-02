# reporting

## ADDED Requirements

### Requirement: Budget-to-Ledger Reconciliation by Account and Fiscal Year

The system SHALL expose a read-only, company-scoped report that, for each account carrying a budget
in a chosen fiscal year, reports what the budget says and what the ledger says, and the difference
between them.

For each such account the report SHALL carry:

- **appropriated** — `Σ amount_total + Σ ADJUST_INCREASE − Σ ADJUST_DECREASE + Σ TRANSFER_IN −
  Σ TRANSFER_OUT` over that account's budgets for the year;
- **committed** — `Σ RESERVE − Σ RELEASE − Σ ACTUAL`, the outstanding reservation;
- **consumed** — `Σ ACTUAL`;
- **moved** — `Σ debit − Σ credit` on that account over the journal lines whose entry falls in the
  fiscal year's date range;
- **difference** — `moved − consumed`.

`moved` SHALL be taken in the direction the account naturally moves rather than as an absolute, so
that an expense account reduced by a reversal reports a reduction. The fiscal year SHALL be resolved
from the entry's `entry_date`, which is already the posting company's own calendar day, and never
from a timestamp.

The report SHALL be derived on read. It SHALL NOT store a reconciled figure, write any `budget_txn`,
write any `journal_entry`, or alter any document — a stored reconciliation is a third opinion about
facts two ledgers already hold.

It SHALL be gated by the reporting permission and scoped to the active company (invariant 1).

#### Scenario: An account with budget and ledger movement is reconciled

- **GIVEN** an account with an active budget for a fiscal year and journal lines dated inside it
- **WHEN** the reconciliation is read for that year
- **THEN** the row reports the appropriated, committed and consumed figures from the budget, the
  movement from the ledger, and the difference between consumed and moved

#### Scenario: A reversal reduces the ledger movement

- **GIVEN** an expense account debited 1,000 and later credited 1,000 by a reversal in the same year
- **WHEN** the reconciliation is read
- **THEN** the movement reported for that account is zero, not 2,000

#### Scenario: Movement outside the fiscal year is excluded

- **GIVEN** journal lines on a budgeted account dated after the fiscal year ends
- **WHEN** the reconciliation is read for that year
- **THEN** those lines are not counted in the movement

#### Scenario: Another company's budgets and entries are absent

- **WHEN** the reconciliation is read
- **THEN** no budget and no journal line of another company contributes to any figure

#### Scenario: The report writes nothing

- **WHEN** the reconciliation is read twice
- **THEN** no `budget_txn`, no `journal_entry` and no `gl_posting_attempt` row has been created or
  changed

### Requirement: The Difference Is Decomposed Until Nothing Is Unexplained

The report SHALL decompose each account's difference into named causes and SHALL report what remains
after them as **unexplained**. A single difference figure states that two books disagree without
giving anyone a way to act, and the decomposition is what makes the report answerable.

The causes SHALL be:

- **ledger movement from sources that consumed no budget**, grouped by the entry's `source_type` —
  a journal entry whose source has no `ACTUAL` row;
- **budget consumption capitalised into stock** — the share of a document's `ACTUAL` the posting
  engine diverted to the goods-received account instead of the budgeted expense account, taken as
  the difference between that document's `ACTUAL` on the account and the debits its entries put
  there, rather than re-derived from the stock lines;
- **budget consumption whose posting never arrived** — `ACTUAL` rows for a document with no journal
  entry at all.

The unexplained remainder SHALL be reported per account. A non-zero unexplained figure means a cause
this report does not model, and SHALL be presented as something to investigate rather than as a
rounding.

#### Scenario: A manual voucher on a budgeted account is explained

- **GIVEN** a posted journal voucher debiting an account that carries a budget
- **WHEN** the reconciliation is read
- **THEN** its amount appears under the `MANUAL_JV` cause and the unexplained remainder is unchanged

#### Scenario: A stock purchase is explained by its capitalisation

- **GIVEN** a document whose stock-tracked lines were charged to a budget and debited to the
  goods-received account
- **WHEN** the reconciliation is read
- **THEN** the amount appears under the capitalisation cause and the unexplained remainder is zero

#### Scenario: A reversal that did not return the budget is visible

- **GIVEN** a settled document whose posting was later reversed, with no budget adjustment raised
- **WHEN** the reconciliation is read
- **THEN** the reversal appears under the `REVERSAL` cause, and the budget still reports the amount
  as consumed

#### Scenario: Everything explained leaves nothing unexplained

- **GIVEN** an account whose only activity is budget-derived postings
- **WHEN** the reconciliation is read
- **THEN** its unexplained remainder is zero

### Requirement: Vouchers Reaching Budgeted Accounts Are Reported On Their Own

The report SHALL report, as a figure of its own, the total that journal vouchers moved on accounts
carrying a budget, and SHALL list the vouchers behind it.

This is separated from the other causes because it measures something no control observes: a voucher
writes no `budget_txn`, so expense can reach a budgeted account without any availability check being
consulted. The figure states how much has taken that path.

The report SHALL NOT treat the figure as an error. A company that budgets for depreciation would
expect its monthly voucher to appear here; one that does not would expect the opposite. Which of
those is intended is a policy this report does not hold.

#### Scenario: The total and its vouchers are readable

- **GIVEN** two posted vouchers touching budgeted accounts and one touching only unbudgeted accounts
- **WHEN** the reconciliation is read
- **THEN** the figure covers the first two, and lists them, and excludes the third

#### Scenario: No such voucher reports zero rather than nothing

- **GIVEN** a company whose vouchers touch only unbudgeted accounts
- **WHEN** the reconciliation is read
- **THEN** the figure is zero and is still reported
