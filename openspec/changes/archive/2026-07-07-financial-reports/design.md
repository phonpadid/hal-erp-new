## Context

`journal_entry` / `journal_line` hold balanced double-entry postings against a typed chart of
accounts (`account.account_type` ∈ ASSET / LIABILITY / EQUITY / REVENUE / EXPENSE), company-scoped,
with `entry_date` on the header. Every settlement posts a balanced entry. What's missing is the
read side — the financial statements. This slice adds them as pure aggregations of the journal; it
writes nothing and adds no schema.

## Goals / Non-Goals

**Goals:**
- Trial balance (debit/credit totals per account + the Σdr = Σcr check) over a date range.
- Account ledger (every line for one account + running balance + source-document link).
- Income statement (revenue − expense → net income) over a date range.
- Balance sheet (assets / liabilities / equity as of a date, with derived retained earnings and the
  Assets = Liabilities + Equity check).
- Read-only, company-scoped, `GL_VIEW`-gated, money as decimal strings.

**Non-Goals:**
- No posting periods / period-close (the balance sheet's retained earnings is derived, not rolled).
- No comparative/multi-period columns, no cash-flow statement, no AP/AR aging, no statutory forms.
- No new tables, columns, or writes of any kind.

## Decisions

**1. One shared aggregation, four shaped reports.** All four reports derive from a single query:
sum `journal_line.debit` and `journal_line.credit` grouped by `account`, filtered by company and a
date window on `journal_entry.entry_date`. The trial balance is that list; the P&L filters to
REVENUE/EXPENSE; the balance sheet filters to ASSET/LIABILITY/EQUITY (plus a derived retained-earnings
figure); the account ledger is the un-aggregated lines for one account. This keeps the sign/normal
rules in one place and guarantees the reports reconcile with each other.

**2. Sum with the `Money` decimal helper, not the DB.** The service loads the relevant
`journal_line`s (joined to `account`, filtered by company + date) and folds debit/credit with
`Money.add` — money stays a decimal string end to end (invariant: never a JS number). A DB `SUM`
returns numeric/float and is avoided. _Trade-off:_ this reads rows rather than aggregating in SQL; for
the first slice the journal is small and correctness beats micro-optimization. If the ledger grows,
a later pass can push the aggregation into SQL with a decimal cast — noted, not premature.

**3. Normal-balance / sign rules, centralized.**
- Account **balance** = Σdebit − Σcredit (natural signed balance).
- Debit-normal (ASSET, EXPENSE): presented as the natural balance.
- Credit-normal (LIABILITY, EQUITY, REVENUE): presented as Σcredit − Σdebit so a normal balance is
  positive.
- **Trial balance** shows, per account, the balance in its normal column; the sum of all debit-side
  balances MUST equal the sum of all credit-side balances (the report states both and their equality).
- **P&L**: revenue = Σ(credit − debit) over REVENUE; expense = Σ(debit − credit) over EXPENSE; net
  income = revenue − expense, over the date range.
- **Balance sheet** as of a date (entry_date ≤ asOf): assets = Σ(debit − credit) over ASSET;
  liabilities = Σ(credit − debit) over LIABILITY; equity = Σ(credit − debit) over EQUITY; retained
  earnings = cumulative net income to the date (Σ REVENUE credit-net − Σ EXPENSE debit-net). Check:
  assets = liabilities + equity + retained earnings.

**4. Retained earnings is derived (no period-close).** Because REVENUE/EXPENSE are never rolled into
an equity account (no close process), the balance sheet computes retained earnings on the fly as the
cumulative net income up to `asOf`. The report surfaces this as an explicit "Retained earnings
(current period)" line and reports the balance check, so a reader knows it is a live-derived
statement, not a closed-period one. A future period-close slice replaces the derivation with a rolled
balance without changing the report shape.

**Read-only, no ledger writes (invariants 2, 6).** None of the endpoints write; all run through the
active-company scope (invariant 1). No `budget_txn` / `journal` rows are created — this is a read
surface only, so there is no transaction boundary or lock to specify.

## Risks / Trade-offs

- **[Balance sheet doesn't balance because retained earnings is derived]** → It balances by
  construction: assets − liabilities − equity ≡ cumulative net income = the derived retained-earnings
  line. The report asserts the check and shows the difference (expected 0); a non-zero difference
  signals an unbalanced journal (which the posting engine's Σdr = Σcr guard already prevents).
- **[Row-level aggregation is slow at scale]** → Accepted for the first slice (small ledger); the
  single-query design makes a later SQL-sum optimization a localized change. Documented, not hidden.
- **[Mixing dates: entry_date window vs. as-of]** → The P&L and trial balance take a `[from, to]`
  window; the balance sheet takes a single `asOf` (entry_date ≤ asOf). Both filter on
  `journal_entry.entry_date`, kept explicit per report so the semantics aren't conflated.
- **[Sign confusion between reports]** → All sign rules live in one helper (decision 3); each report
  calls it, so a debit-normal vs credit-normal mistake can't diverge between the trial balance and the
  statements.
