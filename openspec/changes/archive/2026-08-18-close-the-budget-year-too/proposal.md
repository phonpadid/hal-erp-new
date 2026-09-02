# Close the budget year too

## Why

Closing a fiscal year is thorough on one side of the house and silent on the other.

```
the ledger                                    the budget
──────────                                    ──────────
every revenue account zeroed                  nothing
every expense account zeroed                  nothing
the result posted to RETAINED_EARNINGS        nothing
fiscal_year.status = CLOSED                   nothing reads it
a closed period refuses new entries           budget_txn has no such guard
```

`grep -rn CLOSED back/src/modules/budget` returns nothing. The budget module does not know the
concept exists.

**An appropriation outlives the year it was voted for.** A budget with three million unspent on 31
December still has three million on 1 January, on a fiscal year the ledger has declared finished.
Nothing lapses it and nothing carries it forward, so the figure is neither closed nor rolled — it
simply persists, and the only thing stopping someone spending it is a guard on the document's date,
which lives in a different module and checks a different thing.

**An open encumbrance can outlive its year.** A purchase requisition submitted on 20 December holds
a `RESERVE` against the 2026 appropriation. If it is approved on 5 January, the post-action writes
`ACTUAL` against the 2026 budget and the journal entry lands on 5 January — in 2027's books. The
expense is recognised in one year and charged against another year's appropriation. In the
budget-to-ledger reconciliation, that shows up as an `unexplained` difference in **both** years, in
a report whose requirement is titled *The Difference Is Decomposed Until Nothing Is Unexplained*.

**Nothing refuses a budget row against a closed year.** `gl-journal` refuses an entry whose day falls
in a closed period, at the single point every entry is constructed, and records the refusal rather
than dropping it. `budget_txn` has no equivalent: a `RESERVE`, an `ACTUAL`, a `TRANSFER` may be
written against a closed year's appropriation and nothing objects.

**The pattern for this already exists in the codebase.** `accounting-period` refuses to close a
period while its postings are undrained, and names what is blocking. A year whose budget still has
documents in flight is the same situation, and deserves the same answer.

## What Changes

**A year cannot be closed while budget-consuming documents are still routing against it.** Closing
the year's final period first checks for documents that hold an open reservation on that year's
budgets and are not yet in a terminal state. If any exist the close is refused, naming them, exactly
as an undrained posting refuses a period close today. Finishing or cancelling them is the work the
refusal asks for, and both paths already exist.

**Closing the year closes its budgets.** With no document left holding a reservation, the close marks
that year's budgets `CLOSED`: the appropriation stands as a record of what was voted and what was
spent, and it is no longer a pot anything can draw on.

**A closed year's budget refuses new rows.** `budget_txn` gains the guard `journal_entry` already
has — a write against a `CLOSED` fiscal year's budget is refused where budget rows are written, not
hoped against at each call site.

**Both halves happen in the operation that closes the year**, before the period's own status is set,
in the same transaction as the closing entry, and keyed to the fiscal year so a retried close cannot
do it twice. The year-close is already shaped this way for the ledger; the budget joins it rather
than getting a ceremony of its own.

Nothing has launched, so no open year needs migrating.

## Who this answers

| party | what happened before | after |
| --- | --- | --- |
| accountant | last year's appropriation was still spendable | a closed year is closed on both sides |
| auditor | an expense in 2027 charged to 2026's budget, unexplained | the case cannot arise; the close refuses until it is resolved |
| budget owner | no signal that a requisition would strand at year end | the close names exactly which documents are holding the year open |
| whoever closes the year | closed the ledger and hoped about the budget | one act, both books, refused until it is safe |
| the reconciliation | carried a permanent unexplained remainder | its largest systematic cause is gone |

## What This Change Does NOT Do

- **Does not carry anything forward.** Rolling an unspent appropriation or an open encumbrance into
  the next year is a policy decision — some organisations lapse, some carry, and the ones that carry
  need next year's budget rows created, the encumbrance moved, and a record of which year the money
  originally belonged to. That is its own change, and the refusal this one introduces is what makes
  it safe to postpone: nothing strands silently in the meantime.
- **Does not lapse anything either.** With no open reservation left, there is nothing to release; the
  unspent balance simply stops being drawable because its year is closed. No `RELEASE` rows are
  invented to represent a policy nobody has chosen.
- **Does not change reopening.** A reopened year's budgets return to `ACTIVE` by the same act that
  returns the period to `OPEN`, because a reopened year is open on both sides or the asymmetry comes
  straight back.
- **Does not touch the balance formula, the control points, or the tolerance ladder.**
