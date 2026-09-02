# Name the year boundary in the reconciliation

## Why

The budget-to-ledger reconciliation sets itself a standard in the title of one of its requirements:
*The Difference Is Decomposed Until Nothing Is Unexplained*. It cannot meet it, because the two
sides it compares do not mean the same thing by "this year".

```
budget side    budget_txn ──▶ budget.fiscal_year          which appropriation it drew on
ledger side    journal_entry ──▶ entry_date ∈ [start, end]  which year the event fell in
```

`budget-ledger-reconciliation.service.ts:121` selects budgets by `fiscalYear`;
`:176` bounds entries by `entryDate` inside the year. Those agree for every document submitted and
completed inside one year, and part company at the year boundary:

```
20 Dec 2026   submit          RESERVE on the 2026 appropriation
 5 Jan 2027   approve         ACTUAL on the 2026 appropriation
                              journal entry dated 5 Jan 2027

2026 report   budget consumed 100,000   ledger moved 0        difference 100,000
2027 report   budget consumed 0         ledger moved 100,000  difference (100,000)
```

Neither difference matches a cause the report models — it is not stock capitalisation and not a
posting that never arrived — so both land in `unexplained`, the figure the spec says every other
cause is subtracted to drive to zero. An unexplained remainder that appears every December teaches
readers to ignore the column, which is worse than not having it.

`close-the-budget-year-too` stops this arising *going forward*: a year cannot close while a document
still holds a reservation against it. But it does not make the report able to *see* the case, and
the case survives inside an open year — a December document approved in January against a 2026 year
that is not closed until March produces exactly the split above, legitimately, for months.

The report needs to name it, and until `date-every-budget-row` lands it cannot: with no date on
`budget_txn` there is no way to tell a row that fell inside its year from one that did not.

## What Changes

**A new named cause: consumed against this year, posted in another.** For each account, the report
reports the consumption whose `txn_date` falls outside the fiscal year of the appropriation it drew
on, and subtracts it from the unexplained remainder like every other cause. The figure is signed —
consumption that arrived early and consumption that arrived late are different facts about a cutoff
— and each contributing document is listed, because "which requisitions crossed the boundary" is the
question the number provokes.

**The primary grouping is unchanged.** The budget side still selects by `budget.fiscal_year`: an
appropriation belongs to the year it was voted for, and a row that consumes it belongs to that
appropriation whatever day it fell on. The date is what makes the boundary *visible*, not what
regroups the report.

**The unexplained remainder keeps its meaning.** It is what is left after every modelled cause, and
after this change the largest recurring contributor to it has a name. A non-zero remainder goes back
to meaning what the spec says it means: a cause this report does not model yet.

## Who this answers

| party | what they saw | after |
| --- | --- | --- |
| accountant | an unexplained difference every December | a named cutoff figure, with the documents behind it |
| auditor | a reconciliation that never reconciles | every difference is attributed or genuinely novel |
| budget owner | last year's report disagreeing with the ledger | the disagreement is explained by dates they can check |
| whoever closes the year | no list of what is straddling the boundary | the cause names each document |

## What This Change Does NOT Do

- **Does not move consumption between years.** Reporting a cutoff is not restating one. If a figure
  belongs in the other year, that is a correction somebody makes deliberately — a budget adjustment
  and a journal entry — not something a report performs.
- **Does not change the balance formula or any budget figure.** It reads.
- **Does not depend on the year being closed.** The cause is computed from dates, so it works inside
  an open year, which is where the case actually lives once
  `close-the-budget-year-too` prevents it surviving a close.
- **Does not add budget phasing or a burn-rate comparison.** Comparing consumption to elapsed time
  is a useful next question and needs no schema change; it is a different report requirement and
  should be argued on its own.
