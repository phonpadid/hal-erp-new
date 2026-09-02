# Design

## D1. The report's own arithmetic says where the cause goes

```ts
// budget-ledger-reconciliation.service.ts
difference   = moved − consumed
unexplained  = difference − sourcesWithoutBudgetTotal + capitalisedIntoStock + postingNeverArrived
```

Every modelled cause is a term subtracted from `difference` until nothing is left. A new cause is a
new term, computed the same way and reported beside the others:

```ts
unexplained = difference − sourcesWithoutBudgetTotal
                         + capitalisedIntoStock
                         + postingNeverArrived
                         + consumedOutsideItsYear      ← new
```

The sign follows the others: `consumed` is subtracted to form `difference`, so consumption that
should not have counted for this year is added back.

## D2. What the figure is, precisely

For the fiscal year Y being reported, and for each account:

> `consumedOutsideItsYear` = Σ of `ACTUAL` rows on Y's budgets whose `txn_date` falls outside
> `[Y.startDate, Y.endDate]`.

That is consumption charged to Y's appropriation on a day the ledger will have posted into a
different year. It is exactly the quantity that makes `moved` and `consumed` disagree without any
of the existing causes applying.

**Only `ACTUAL`.** `consumed` is `Σ ACTUAL`, so only `ACTUAL` can move it. A `RESERVE` dated outside
the year affects `committed`, which the reconciliation does not reconcile against the ledger —
nothing is posted when money is committed.

**Signed, not absolute.** A row dated *before* the year and one dated *after* are different facts
about a cutoff: the first is last year's spending charged to this year's pot, the second is this
year's pot spent in next year's books. They net in the arithmetic but they are reported as two
figures, because "we have 40,000 arriving late and 40,000 arriving early" is a different situation
from "nothing crossed".

## D2b. The crossing is subtracted BEFORE the two per-document causes, not beside them

Found while implementing, and it changes the shape of the change: the new cause is not simply
another term added to the arithmetic. It **overlaps** the two causes derived per document, and the
overlap double-counts.

`postingNeverArrived` is `ACTUAL` rows for a document with no journal entry — and "no journal entry"
is asked as *no entry inside this fiscal year* (`documentsWhosePostingArrived` is built from
`postedInFy`). A December document settled in January has no entry inside 2026, so it satisfies that
test exactly as a stranded document does:

```
consumed 400   moved 0   difference −400
  crossing            +400     correct
  neverArrived        +400     the same money, claimed twice
  ──────────────────────────
  unexplained          400     in a report whose point is that this is zero
```

Widening `postingNeverArrived` to ask "any entry at all" does not fix it — the document would then
fall into `capitalisedIntoStock` instead, because its in-year debits on the account are zero and its
`ACTUAL` is not, which is the shape that cause looks for. The crossing is invisible to both tests
because both ask a question the crossing answers accidentally.

**So the crossing is taken off first, by amount, and the remaining causes see only what is left.**
For each (account, document):

```
crossed    = Σ ACTUAL dated outside [fy.start, fy.end]
inYear     = Σ ACTUAL − crossed          ← what never-arrived and capitalised are computed on
```

By amount rather than by document, because a document settled partly in December and partly in
January has both, and dropping the whole document would hide the half that genuinely belongs to the
year.

This matches the principle the report already follows: the difference is decomposed until nothing is
left, and **each amount is subtracted by exactly one cause**. It also makes the attribution the
truthful one — "posted in another year" is what happened; "the posting never arrived" is false,
because it did arrive.

## D3. The primary grouping does not move

The budget side keeps selecting by `budget.fiscal_year`. It is tempting to bound it by `txn_date`
like the ledger side, and it is wrong: a row consuming Y's appropriation on a day in Y+1 would then
appear in **neither** year's report — dropped from Y by the date bound, and dropped from Y+1 because
that report selects Y+1's budgets. The report would balance by losing the evidence.

An appropriation belongs to the year it was voted for, and a row that consumes it belongs to that
appropriation whatever day it fell on. The date is a second reading that makes the crossing
*visible*; it is not a regrouping.

## D4. The documents behind the number

A figure like this provokes exactly one question — *which ones?* — so the cause carries the
contributing documents: document number, the day the consumption was dated, the day range it should
have fallen in, and the amount. The same shape the report already uses for
`VoucherOnBudgetedAccount`, which exists for the same reason.

Capped and counted, like every other list in these reports, so an account with two hundred
stragglers reports the total and a readable sample rather than two hundred rows.

## D5. This depends on `date-every-budget-row`, and says so

Without `budget_txn.txn_date` the cause is not merely hard to compute — it is not computable at all,
because nothing on the row says when it happened. This change is meaningless before that one and
trivial after it: one aggregation over rows the report already loads, plus a term in an arithmetic
line that already exists.

## D6. It is not made redundant by `close-the-budget-year-too`

That change stops a year *closing* while documents still hold it, which removes the case at the
point of closure. It does not remove the case from an **open** year: a December document approved in
January, against a 2026 year that is not closed until March after the audit, produces exactly this
split legitimately, for months. The report must be able to explain the year it is looking at while
that year is still open — which is when people actually read it.

The two changes are complements, not alternatives: one prevents the case surviving a close, the
other explains it while it lives.

## D7. What this leaves for later

| left out | why |
| --- | --- |
| moving the consumption to the right year | reporting a cutoff is not restating one; a correction is a budget adjustment and a journal entry somebody makes deliberately |
| a burn-rate or elapsed-time comparison | a different question, answerable now that consumption has dates, and it deserves its own requirement rather than riding in |
| the same treatment for `committed` | nothing is posted when money is committed, so there is no ledger figure for it to disagree with |

## Risks / trade-offs

- **A fifth cause makes a dense report denser.** → It replaces an unexplained remainder with a named
  one; the reader's total workload goes down, not up. And unlike the remainder, it comes with the
  documents that produced it.
- **The figure will usually be zero.** → So will the others, most months. A cause that reads zero is
  the report saying "not this"; the value is in the December it does not.
- **Two reports for one document.** A crossing document appears in Y's report as consumption outside
  its year and in Y+1's as ledger movement with no budget behind it — which is already a modelled
  cause there (`postingNeverArrived` covers the inverse case, and `sourcesWithoutBudget` names
  movement with no budget). → That is correct and the two are consistent: each year explains its own
  difference, and the same document is named in both.
- **This change writes nothing.** It is a read: one aggregation, one term, one list.
