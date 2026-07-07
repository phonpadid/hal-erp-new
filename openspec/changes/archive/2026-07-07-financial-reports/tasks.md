## 1. Backend: aggregation core

- [x] 1.1 In the general-ledger module, add a `FinancialReportsService`. Add a private core that loads `journal_line` (joined to `account`, populated) for the active company filtered by a date window on `journal_entry.entry_date`, and folds debit/credit per account with the `Money` helper (never a JS number).
- [x] 1.2 Add a normal-balance helper: ASSET/EXPENSE are debit-normal, LIABILITY/EQUITY/REVENUE are credit-normal; centralize the signed-balance and normal-side presentation so every report shares it.

## 2. Backend: the four reports

- [x] 2.1 `trialBalance(from, to)`: per-account debit total, credit total, and normal-side balance; plus total debits and total credits (which must be equal).
- [x] 2.2 `accountLedger(accountId, from, to)`: every line for the account in `entry_date` order with a running balance and each line's journal entry + source document reference.
- [x] 2.3 `incomeStatement(from, to)`: revenue (Σ credit−debit over REVENUE), expense (Σ debit−credit over EXPENSE) grouped by account, and net income.
- [x] 2.4 `balanceSheet(asOf)`: assets/liabilities/equity as of the date, retained earnings = cumulative net income to date, and the `assets = liabilities + equity + retained earnings` check.

## 3. Backend: controller & DTOs

- [x] 3.1 Add a `FinancialReportsController` with `GL_VIEW`-gated endpoints (`/financial/trial-balance`, `/financial/ledger/:accountId`, `/financial/income-statement`, `/financial/balance-sheet`), company-scoped, `ParseUUIDPipe` on the account id, date query params validated.
- [x] 3.2 Wire the service + controller into the general-ledger module.

## 4. Frontend

- [x] 4.1 Typed API client + Pinia store for the four reports (date-range / as-of params).
- [x] 4.2 Trial Balance view: account rows with debit/credit columns, totals row with the balance check; each row links into the Account Ledger.
- [x] 4.3 Account Ledger view: lines with running balance and a link to the source document; date-range filter.
- [x] 4.4 Income Statement view: revenue and expense groups with net income.
- [x] 4.5 Balance Sheet view: assets / liabilities / equity / retained-earnings sections with the balance check and a derived-basis note; as-of date filter.
- [x] 4.6 Routes + nav entries (Reports/Accounting area), gated by `GL_VIEW`; i18n keys (en + la). Money formatted by the currency decimal places (never a JS number for storage/transport).

## 5. Tests

- [x] 5.1 Unit: trial balance — total debits equal total credits; each account lands in its normal side.
- [x] 5.2 Unit: account ledger — lines in date order with a correct running balance; source document is referenced.
- [x] 5.3 Unit: income statement — net income = revenue − expense over the range.
- [x] 5.4 Unit: balance sheet — assets = liabilities + equity + (derived) retained earnings; retained earnings equals cumulative net income to date.
- [x] 5.5 Unit: company isolation + authorization — reports aggregate only the active company and reject requests without `GL_VIEW`.
- [x] 5.6 Frontend: trial balance renders with a balancing totals row; balance sheet renders the balance check.
