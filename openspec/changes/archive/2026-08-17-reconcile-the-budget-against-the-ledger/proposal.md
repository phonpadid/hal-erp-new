# Reconcile the budget against the ledger

## Why

This system keeps two ledgers over the same money and never puts them side by side.

`budget_txn` answers *how much are we still authorized to commit*. `journal_line` answers *how much
have we recognised as expense*. Both are append-only, both are company-scoped, both are derived
rather than stored — and no report in the system reads from both. A search of
`openspec/specs` and `back/src` for "budget variance", "budget-to-actual" or "budgetary comparison"
returns nothing:

- `reporting` — 15 requirements, budget only, never touches a journal line
- `financial-reports` — 4 requirements, ledger only, never touches a budget

The two figures are allowed to differ; a commitment basis and an accrual basis are different
questions. What is not allowed is for nobody to be able to say BY HOW MUCH and WHY. IPSAS 24 and the
GASB budgetary comparison schedule both require the comparison and an explanation of material
differences, precisely because the bases differ.

Three specific ways the two are known to diverge today, none of them visible:

**The GL derives its expense FROM the budget.** `GlPostingService` reads the `ACTUAL` rows and posts
the amount and the account it finds there. Nothing checks afterwards that the two agree, and one is
computed at the budget exchange rate while the payment is settled at the daily one.

**An expense with no budget is recorded nowhere.** When a document has no `ACTUAL` row the posting
logs `GL posting skipped: no ACTUAL budget_txn` and records `SKIPPED` — a TERMINAL state that the
undelivered-postings read deliberately excludes. The company owes the money, the ledger says
nothing, and no screen in the system will ever mention it again.

**A journal voucher can move expense between budgeted accounts without touching a budget.** A
voucher writes no `budget_txn` — correctly, for depreciation and opening balances. But the same
voucher can debit one budgeted account and credit another, and no availability check is consulted
for either.

Nobody knows how often any of this happens, because nothing counts it. That is what this change
fixes, and it is deliberately ALL it fixes.

## What Changes

**A reconciliation read, by account and fiscal year.** For each account carrying a budget: what the
budget says was appropriated, committed and consumed; what the ledger says moved; and the difference
between them.

**The difference is decomposed until the residual is zero.** A single difference figure is a report
nobody dares act on. Each explainable cause is named and quantified — ledger movements from sources
that consumed no budget, broken down by `source_type`; amounts charged to a budget but capitalised
into stock rather than expensed; budget consumption whose posting never arrived — and what remains
after all of them is reported as **unexplained**. That last number is the only one that needs
reading, and it should be zero.

**Vouchers touching budgeted accounts are counted separately.** The `MANUAL_JV` share of the
difference is the size of the back door: expense that reached a budgeted account without passing any
availability check. It is reported as its own figure because it is the input to a decision the
business has not made yet.

**Expenses skipped for want of a budget become readable.** A company-scoped read of the postings
recorded `SKIPPED` where the document had no `ACTUAL` — the expenses that exist in the world and in
no ledger. The reconciliation above cannot see these: both sides are zero and the difference is
zero, so a report without this read would certify the books as reconciled at the exact moment they
were most wrong.

**A screen** showing all of it for a chosen fiscal year.

## What This Change Does NOT Do

- **Writes nothing.** No `budget_txn`, no `journal_entry`, no schema change, no migration. Every
  figure is derived from `budget`, `budget_txn`, `journal_line`, `journal_entry` and
  `gl_posting_attempt` as they already stand.
- **Changes no behaviour.** Submit still accepts what it accepts, vouchers still write no budget
  rows, documents with no budget still skip their posting. This change measures; the decisions the
  measurements inform are separate proposals.
- **Does not compare by department.** `journal_line` carries no department, and the entries that
  could be traced to one through their document are exactly the budget-derived ones — a
  department-level comparison would be a tautology over the rows that agree by construction, and
  blind to every row that does not. The account is the only honest axis.
- **Does not correct anything it finds.** A difference this report explains is a difference somebody
  now has to decide about. Correcting a budget is an approved adjustment document and correcting the
  ledger is a voucher; both already exist and both are deliberately somebody's decision.
