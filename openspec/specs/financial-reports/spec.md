# Financial Reports Specification

## Purpose
Read-only financial statements derived from the general-ledger journal: trial balance, account
ledger (GL detail), income statement, and balance sheet. All are aggregations of `journal_line`
over the chart of accounts — company-scoped, `GL_VIEW`-gated, money as decimal strings — and they
write nothing. Because there is no period-close yet, the balance sheet derives retained earnings as
the cumulative net income to date.

## Requirements

### Requirement: Trial Balance

The system SHALL expose a read-only trial balance for the active company over a date range
(`from`..`to` on `journal_entry.entry_date`), listing each account with its total debits and total
credits and its normal-side balance. The report SHALL state the sum of all debit balances and the
sum of all credit balances, and these two totals MUST be equal. The report MUST NOT mutate any
ledger and SHALL be gated by `GL_VIEW`.

#### Scenario: Debits equal credits

- **GIVEN** journal lines Dr expense 100000, Cr cash 100000 in the range
- **WHEN** the trial balance is requested
- **THEN** the expense account shows a 100000 debit balance, the cash account a 100000 credit
  balance, and total debits (100000) equal total credits (100000)

#### Scenario: Company-scoped and permission-gated

- **WHEN** a `GL_VIEW` user in company A requests the trial balance
- **THEN** only company A's journal lines are aggregated, and a request without `GL_VIEW` is rejected
  with 403

### Requirement: Account Ledger Detail

The system SHALL expose a read-only account ledger: for one account over a date range, every
`journal_line` in `entry_date` order with a running balance, and each line's source journal entry
(and its document reference). The report MUST NOT mutate any ledger and SHALL be company-scoped and
`GL_VIEW`-gated.

#### Scenario: Running balance accumulates in entry order

- **GIVEN** an account with a Dr 100 then a Cr 30 in the range
- **WHEN** the account ledger is requested for it
- **THEN** the two lines are returned in date order with running balances 100 then 70

### Requirement: Income Statement

The system SHALL expose a read-only income statement for the active company over a date range:
revenue (Σ credit − debit over REVENUE accounts), expense (Σ debit − credit over EXPENSE accounts),
each grouped by account, and net income (revenue − expense). It MUST NOT mutate any ledger and SHALL
be company-scoped and `GL_VIEW`-gated.

#### Scenario: Net income is revenue minus expense

- **GIVEN** REVENUE credit 50000 and EXPENSE debit 30000 in the range
- **WHEN** the income statement is requested
- **THEN** revenue is 50000, expense is 30000, and net income is 20000

### Requirement: Balance Sheet

The system SHALL expose a read-only balance sheet as of a date (`journal_entry.entry_date` ≤ `asOf`):
assets (Σ debit − credit over ASSET), liabilities (Σ credit − debit over LIABILITY), equity (Σ credit
− debit over EQUITY), and retained earnings derived as the cumulative net income to that date (there
is no period-close). The report SHALL include the balance check `assets = liabilities + equity +
retained earnings` and MUST NOT mutate any ledger; it SHALL be company-scoped and `GL_VIEW`-gated.

#### Scenario: Assets equal liabilities plus equity plus retained earnings

- **GIVEN** a company whose ledger to date has assets 104000, liabilities 4000, equity 0, and a
  cumulative net income of 100000
- **WHEN** the balance sheet is requested as of that date
- **THEN** it reports assets 104000, liabilities 4000, equity 0, retained earnings 100000, and the
  balance check holds (104000 = 4000 + 0 + 100000)

#### Scenario: Retained earnings is shown as derived

- **WHEN** the balance sheet is requested
- **THEN** retained earnings is presented as a current-period derived figure (cumulative revenue −
  expense), reflecting that no period-close has rolled it into equity
