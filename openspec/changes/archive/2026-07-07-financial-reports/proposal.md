## Why

The double-entry general ledger now records balanced journal entries against a typed chart of
accounts, but there are no **financial statements** to read it back — no trial balance, no account
ledger drill-down, no profit-and-loss, no balance sheet. The existing reports are operational
(budget / quota / document / spend); the accounting side is write-only. This change adds the core
financial reports, computed entirely by aggregating the existing `journal_line` data — no new
ledger, no schema change.

## What Changes

- **Trial Balance** — every account's debit and credit totals over a date range, with the
  Σdebit = Σcredit balance check. The foundation that proves the GL is internally consistent.
- **Account Ledger (GL detail)** — every `journal_line` for one account over a date range with a
  running balance and a link back to the source document; the drill-down from the trial balance.
- **Income Statement (P&L)** — revenue minus expense over a date range → net income, grouped by
  account, using the account `account_type`.
- **Balance Sheet** — assets, liabilities, and equity as of a date, with **retained earnings
  computed on the fly** (cumulative revenue − expense up to the date) since there is no
  period-close yet; includes the `Assets = Liabilities + Equity` balance check.
- All reports are **read-only**, company-scoped, gated by `GL_VIEW`, and returned with money as
  decimal strings (never a JS number). They surface as views under the Reports/Accounting area.
- **Out of scope (later):** posting periods / period-close (which would make the balance sheet's
  retained-earnings roll authoritative rather than derived), comparative/multi-period columns,
  cash-flow statement, AP/AR aging, and statutory tax-return forms.

## Capabilities

### New Capabilities
- `financial-reports`: the trial balance, account ledger, income statement, and balance sheet —
  read-only aggregations of `journal_line`, their normal-balance/sign rules, and the balance checks.

### Modified Capabilities
<!-- None. Pure read over the existing gl-journal + chart-of-accounts data. -->

## Impact

- **Data model**: none. Pure reads over `journal_entry` / `journal_line` / `account`.
- **Backend**: a `FinancialReportsService` + controller in the general-ledger module, gated by
  `GL_VIEW`, company-scoped; aggregates journal lines by account/type over a date range using the
  `Money` decimal helper (no float). Normal-balance rules: ASSET/EXPENSE are debit-normal;
  LIABILITY/EQUITY/REVENUE are credit-normal.
- **Frontend**: four read-only views (Trial Balance, Account Ledger, Income Statement, Balance
  Sheet) with a date-range/as-of filter; trial-balance rows link into the account ledger, ledger
  rows link to the source document. Nav entries + i18n (en + la).
- **Invariants**: preserves all core invariants. Company isolation (#1) via the active-company
  scope; append-only ledgers are only read, never written (#2); authorization by permission code
  (#6). The reports MUST NOT mutate any ledger.
- **Risk / caveat**: without period-close, the balance sheet derives retained earnings from all
  revenue/expense to date; a report will note the balance check and the derived basis so it is not
  mistaken for a closed-period statement.
