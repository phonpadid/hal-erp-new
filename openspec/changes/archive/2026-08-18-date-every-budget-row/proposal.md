# Date every budget row

## Why

This system keeps three append-only ledgers. Two of them know when their rows happened; the third
does not.

```
journal_entry     entry_date      the posting company's own calendar day, by an enforced rule
approval_log      acted_at        the moment the action was taken
budget_movement   effective_date  the day a transfer or adjustment takes effect
budget_txn        —               created_at, and it is nullable
```

`budget_txn` is the ledger that answers "what has this budget consumed". It is the only one that
cannot say **when**, and the omission is not cosmetic.

**A budget figure cannot be stated as of a date.** "Consumed as of 30 June" is unanswerable; only
"consumed right now" is. Every other subsidiary ledger in this codebase supports an as-of read
because `financial-reports` needs one — the trial balance, the account ledger, the income statement
and the balance sheet all range over `entry_date`. The budget reports range over nothing, so a
budget balance is a live number that cannot be reproduced tomorrow, and a reconciliation cannot be
re-run for last month to see whether it balanced then.

**A budget row's year comes from the pot it hits, not from when it happened.** `budget_txn` is
grouped into a fiscal year through `budget.fiscal_year`. That is the right primary grouping — an
appropriation belongs to its year — but with no date on the row there is no second reading
available, so nothing can detect a row that consumed one year's appropriation on a day belonging to
the next. That case is real, it happens at every year end, and
`name-the-year-boundary-in-the-reconciliation` cannot name it until the date exists.

**The instruction is dated and the record is not.** `budget_movement.effective_date` states the day a
transfer takes effect; the `TRANSFER_OUT` / `TRANSFER_IN` pair it produces carries no date at all.
The document says when, the ledger forgets.

**`created_at` is not a substitute.** It is nullable, it is the row's insert time rather than the
event's day, and it is a UTC timestamp rather than the company's calendar day — the distinction
`gl-journal` settled for `entry_date` because a date decides which side of a boundary a fact falls
on.

## What Changes

**`budget_txn` gains `txn_date`**, not null: the calendar day of the event the row records, resolved
in the company's own timezone by the same rule `journal_entry.entry_date` uses (`localDateIn`), so
the two ledgers agree about what a day is.

Each writer supplies the day of its own event, not the day the row was inserted:

| row | its day |
| --- | --- |
| `RESERVE` | the document's submit day |
| `ACTUAL` | the day the post-action converted the reservation |
| `RELEASE` | the day of the reject, cancel, or the unused difference at settlement |
| `TRANSFER_OUT` / `TRANSFER_IN` | the movement's `effective_date` |
| `ADJUST_INCREASE` / `ADJUST_DECREASE` | the movement's `effective_date` |

**The derived-balance reads accept an as-of date.** The balance, the breakdown and the ledger read
may be bounded by `txn_date`, defaulting to today, so a figure can be reproduced and a report can be
re-run for a date that has passed. The balance formula itself is untouched (invariant 3).

Nothing has launched, so the column is added not-null with no backfill path.

## Who this answers

| party | what they could not do | after |
| --- | --- | --- |
| accountant | reproduce yesterday's budget figure | any budget read can be taken as of a date |
| auditor | see what the budget said at the period end | the ledger is bounded by a day, like the GL |
| management | ask when the budget was consumed, not just how much | consumption has a date to group by |
| whoever closes a period | re-run the reconciliation for the month just closed | the budget side can be bounded to it |
| the next change | name a row that crossed the year boundary | the date makes the case computable |

## What This Change Does NOT Do

- **Does not change the balance formula.** `amount_total ± adjustments ± transfers − RESERVE +
  RELEASE`, with `ACTUAL` never subtracted, is untouched (invariant 3).
- **Does not change which fiscal year a row belongs to.** The primary grouping stays
  `budget.fiscal_year` — an appropriation belongs to its year, and a row that consumes it belongs to
  that appropriation whatever day it fell on. The date is a second reading, not a replacement.
- **Does not add budget periods inside the year.** Phasing an annual appropriation across months is
  a model change, not a column; a dated ledger makes "consumed in March" answerable without it.
- **Does not touch `budget_control_point`.** Where availability is checked is unrelated to when a
  row happened.
