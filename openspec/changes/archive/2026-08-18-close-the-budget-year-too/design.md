# Design

## D1. The close already has a shape; the budget joins it

`AccountingPeriodService.close` is five numbered steps with the ordering argued in comments:

```
①  refuse if an earlier period is still open
②  refuse if the company still owes postings          ← the drain check
③  accrue GRNI, ③′ revalue FX payables
④  if this is the year's last period → closeYear()    ← the year act
⑤  period.status = CLOSED, log, flush
```

The budget needs two things and both already have a home: a refusal that belongs with ②, and an act
that belongs with ④. Nothing new is invented, and the ordering argument the comments make continues
to hold — the budget act sits inside ④ for the same reason the closing entry does: it must happen
while the period is still open, so a later guard cannot refuse it.

## D2. The refusal: a year with documents still holding its money is not drained

② refuses a close while the company owes postings, and names them. A year whose appropriations are
still reserved by routing documents is the same situation: something is unfinished, and finishing it
changes the figures the close is about to fix.

The check is: any document in a non-terminal state (`DRAFT` is not one — a draft holds nothing) with
an un-released `RESERVE` against a budget of the year being closed. It reads the same ledger the
balance does, so "still held" means what it already means:
`Σ RESERVE − Σ RELEASE − Σ ACTUAL > 0` for that document on that budget.

The refusal names the documents, capped and counted like ②'s does, because the useful message is
"these five, and there are twelve" and the useful next action is to finish or cancel them — both of
which already exist and need no new affordance.

**Why refuse rather than resolve.** Releasing them automatically is a lapse policy; moving them is a
carry-forward policy. Choosing either here would decide, silently and permanently, a question the
organisation should answer — and it would do it inside a period close, where nobody is looking for a
policy decision. Refusing states the problem and leaves the choice with a person.

## D3. Closing the year closes its budgets

With no document holding a reservation, ④ marks that year's budgets `CLOSED` alongside setting
`fiscal_year.status`. The appropriation stays exactly as it is — `amount_total` untouched, every
`budget_txn` row untouched — and stops being a pot anything can draw on.

`CLOSED` joins `DRAFT` / `ACTIVE` / `REJECTED` on `budget.status`. It is distinct from `REJECTED`:
one is a proposal turned down, the other is an appropriation that ran its year. Reports that read
"what was voted and what was spent" read a `CLOSED` budget exactly as they read an `ACTIVE` one; only
spending is refused.

**The coverage invariant.** `budget_control_point` requires every `ACTIVE` budget to be covered by at
least one control point. A `CLOSED` budget is no longer `ACTIVE`, so it falls out of that
requirement — correctly, because a ceiling on a pot nobody can draw from governs nothing. Control
points themselves are not touched: they are configuration keyed to a fiscal year, and a closed year's
points simply stop being consulted because nothing reaches them.

## D4. The guard: a closed year's budget refuses new rows

`gl-journal` refuses an entry dated in a closed period at `createEntry` — the one point every entry
is constructed — rather than at each call site. `budget_txn` has exactly the same shape:
`BudgetLedgerService.insertTxn` is its single writer.

So the guard goes there: a row against a budget whose `status` is `CLOSED` is refused, naming the
budget and its year. One point, and a new caller added later inherits it without knowing it exists.

**What this catches that D2 does not.** D2 stops the *known* case — a document still routing. The
guard stops the unknown ones: a re-queued posting delivering late, an adjustment approved against
last year, a future capability nobody has written. The refusal is loud, not silent, and it is
recorded the way a refused GL posting is: as a failure somebody can see, not a row quietly dropped.

## D5. Reopening, and a pre-existing gap it exposes

Reopening must undo what closing did, or the asymmetry this change removes comes straight back in
the other direction.

`AccountingPeriodService.reopen` today sets `period.status = OPEN`, refuses if a later period is
closed, and demands a reason. It does **not** touch `fiscal_year.status`. So a year's final period
can be reopened while its year stays `CLOSED` forever — and with this change, its budgets would stay
closed too, which is the visible symptom of a gap that already exists.

This change therefore makes reopening the year's final period return `fiscal_year.status` to `OPEN`
and that year's budgets to `ACTIVE`, in the same transaction, recorded on the period log like the
reopen itself.

**What this change deliberately does NOT fix.** `YearCloseService.closeYear` is idempotent by
`(sourceType, sourceId)`: it returns the existing closing entry rather than recomputing one. So a
year reopened, corrected, and re-closed keeps its ORIGINAL closing entry, which no longer reflects
the corrected figures. That is a pre-existing defect in the GL's year close, it is not caused by
this change, and fixing it means deciding whether to reverse-and-repost or to recompute in place —
its own change, with its own audit story. It is named here because this change is the reason
somebody will reopen a year and notice.

## D6. Migration

`budget.status` accepts a new value; no column changes. Nothing has launched, so no closed year
exists to migrate and no budget needs its status re-derived.

## D7. What this leaves for later

| left out | why |
| --- | --- |
| carry-forward | a policy: which budgets, whose encumbrances, and how last year's money is labelled in this year's books. D2's refusal makes postponing it safe |
| lapse as an explicit act | with no open reservation left there is nothing to release; inventing `RELEASE` rows would represent a policy nobody chose |
| recomputing the closing entry on re-close | pre-existing, see D5 |
| closing quotas at year end | `quota_usage` has the same year-shaped question and deserves its own look |

## Risks / trade-offs

- **A year cannot be closed while one forgotten requisition holds a reservation.** → That is the
  point, and the refusal names it. The alternative is closing over the top of it and discovering the
  consequence in a reconciliation months later.
- **Somebody will want to close anyway.** → Cancelling the document releases its hold and is one
  click; that is the honest resolution, and it leaves a record of the decision. A force flag would
  be a lapse policy with no name.
- **`CLOSED` budgets change what reads return.** → Only reads that filter on `ACTIVE` — the
  selectable-budgets read for document creation, which SHOULD stop offering them. Reporting reads
  budgets by fiscal year and is unaffected.
- **This change writes no `budget_txn` and no `journal_entry` of its own.** It adds a refusal, flips
  a status, and adds a guard at the existing single writer. No new lock: the close already runs in a
  transaction, and the guard reads a status on a row the writer has in hand.
