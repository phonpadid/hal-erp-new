# Design

## D1. The account is the only honest axis

The obvious report is "budget vs actual by department and category", which is how every budget
report in this system already reads. It cannot be built, and the reason is worth writing down
because it will be proposed again.

```
budget         (fiscal_year, department, gl_account)  →  amount
journal_line   (             account,    entry_date)  →  debit / credit
                             ^^^^^^^
                       the only shared axis
```

`journal_line` has no department. A department could be recovered for SOME entries by walking
`journal_entry.source_id` to a `document` and reading its department — but those are precisely the
entries the budget produced. The entries that CREATE the difference — `MANUAL_JV`, `FX_REVALUATION`,
`YEAR_CLOSE`, `PERIOD_ACCRUAL`, `STOCK_TXN` — have no document and no department at all.

So a department-level comparison would compare, in every cell, rows that agree by construction,
while every row that disagrees would be missing from it entirely. It would read as a clean
reconciliation and prove nothing. The account is the axis; the department is a question for a later
change that would have to put a department on a journal line first.

## D2. The two figures, exactly

For an account `A` with at least one `budget` row in fiscal year `Y`:

**Budget side** — over the budgets on `A` for `Y`:

```
appropriated = Σ amount_total + Σ ADJUST_INCREASE − Σ ADJUST_DECREASE
                              + Σ TRANSFER_IN     − Σ TRANSFER_OUT
committed    = Σ RESERVE − Σ RELEASE − Σ ACTUAL          (outstanding, invariant 3)
consumed     = Σ ACTUAL
```

`consumed` is the figure being reconciled. `appropriated` and `committed` are shown beside it
because a comparison of consumption against a ceiling nobody states is not a budget comparison — and
because IPSAS 24's schedule shows the original and final appropriation, not only the outturn.

**Ledger side** — over `journal_line` on `A` whose `journal_entry.entry_date` falls within
`fiscal_year.start_date .. end_date`:

```
moved = Σ debit − Σ credit
```

Natural direction, not absolute: an expense account that was credited by a reversal moved backwards,
and reporting that as movement would hide exactly the case worth seeing. This is the same trap
`vatSummary` hit — a liability read as `debit − credit` reports every month as negative — and the
rule is the same: take each account in the direction its type moves.

The fiscal year is resolved by `entry_date`, not by `created_at`. `createEntry` already resolved
`entry_date` in the company's timezone, so there is no instant left to convert and no UTC boundary
to get wrong.

## D3. Decompose until the residual is zero

A report that prints one difference figure is a report that gets looked at once. The difference is
decomposable, and every bucket is derivable from data already stored:

```
  consumed (budget)                                        600,000
  moved    (ledger)                                        655,000
  ──────────────────────────────────────────────────────────────────
  difference                                                55,000

    + ledger movement from sources that consumed no budget
        MANUAL_JV                                           80,000   ← the back door
        STOCK_TXN                                           35,000
        PERIOD_ACCRUAL / _REVERSAL                               0
        FX_REVALUATION / YEAR_CLOSE / VAT_RETURN                 0
        REVERSAL                                                 0   ← budget not returned
    − budget consumption capitalised into stock            −60,000
    − budget consumption whose posting never arrived             0
  ──────────────────────────────────────────────────────────────────
  unexplained                                                    0   ◀── the only number to read
```

**Sources that consumed no budget.** A `journal_entry` whose `source_id` has no `ACTUAL` row.
Grouped by `source_type`, which is already on the entry. This is where a manual voucher on a
budgeted account lands, and where a reversal that took an expense back without returning the budget
lands.

**Capitalised into stock.** For entries whose source DID consume budget, the ledger deliberately
diverts the stock-tracked share to `GRNI` instead of the budgeted expense account — the purchase is
an asset until it is issued. So budget `ACTUAL` on account `A` exceeds ledger movement on `A` by
exactly that share. Derived as the per-document difference between `Σ ACTUAL` on `A` and the debits
that document's entries put on `A`, not by re-deriving the stock split — the posting engine already
decided it, and a second derivation would be free to disagree.

**Posting never arrived.** `ACTUAL` rows for a document with no `journal_entry` at all. Distinct
from the case above: there the money went to a different account, here it went nowhere.

**Unexplained** is what remains. It is the number the report exists to produce, and any value other
than zero is a defect somewhere — in the posting engine, in this report's arithmetic, or in an
assumption written here.

## D4. The reconciliation is blind to the worst case, so the blind spot ships with it

```
document with no budget  →  no ACTUAL  →  posting SKIPPED
                                 │              │
                                 0              0
                                 └── agree! ────┘
```

Both sides are zero, the difference is zero, and the report certifies a reconciliation at the exact
moment an entire expense is missing from both books. A reconciliation report that cannot see its own
worst failure mode is worse than none, because it is believed.

The counter-read therefore ships in the same change rather than as a follow-up: the postings
recorded `SKIPPED` whose document has no `ACTUAL`. Those are expenses that exist in the world, are
owed to somebody, and appear in neither ledger.

## D5. `SKIPPED` stays out of the undelivered read, and the classification is re-derived

`Undelivered Postings Are Queryable` states that `SKIPPED` sources are absent, and that is correct:
the period close asks that read whether a month is drained, and a skip is an answer, not a debt. A
month must not be blocked by a posting the engine already decided not to write.

So this is a SEPARATE read with a different question — not "what does the engine still owe?" but
"what did the engine decide not to say?". It is a reporting read, gated on the reporting permission,
and it never gates a period close.

`gl_posting_attempt` records `SKIPPED` with no reason: `recordOn` accepts an error string and the
skip paths pass none. Two very different things are recorded identically — "the amount was zero, so
there was nothing to post" and "there was no budget, so there was no expense side". Rather than add
a reason column and a write, the distinction is RE-DERIVED: a `SKIPPED` row whose document has no
`ACTUAL` is the second kind. Same derivation the posting engine used, no schema change, and this
change keeps its property of writing nothing.

## D6. Vouchers on budgeted accounts get their own figure

`MANUAL_JV` is one bucket among several in D3, but it is the one that answers a question the business
has open: a voucher can debit a budgeted account with no availability check, and nobody knows whether
that has ever happened.

Reported as its own headline figure, with the vouchers behind it listed, because the two possible
answers lead to completely different work:

- **zero** — the back door exists and has never been used; closing it is a nicety
- **not zero** — budget control has been bypassed by that amount, and closing it is a defect fix

The report does not judge which. Depreciation posted to a budgeted expense account is a legitimate
voucher that will appear here, and a company that budgets for depreciation would expect it to
consume the budget; a company that does not would expect the opposite. That is a policy question,
and this change's job is to put a number next to it.

## D7. Where it lives

The read belongs to `reporting`: it is a read-only, permission-gated, company-scoped aggregation
over derived figures, which is that capability's whole description, and its existing budget-balance
report is the closest neighbour.

The screen belongs to `web-accounting` rather than `web-budgets`. The audience is whoever has to
explain the difference in the financial statements — the same person who closes the period and files
the return — not the budget holder asking what they have left. `web-budgets` answers "can I spend?";
this answers "do the books agree?".

## D8. What this deliberately does not become

Every difference this report surfaces has an obvious follow-up, and none of them belong here:

| what it finds | the tempting fix | why not now |
| --- | --- | --- |
| vouchers on budgeted accounts | make vouchers consume budget | needs a department on a voucher line, a `RESERVE`+`ACTUAL` pair, and a policy on blocking vs warning |
| reversals that did not return budget | write a `RELEASE` on reversal | `MUST NOT release more than was reserved`; the vocabulary has no word for an undone spend |
| expenses with no budget | refuse them at submit, or post to a suspense account | a policy decision with no measurement behind it yet |
| the budget-rate expense basis | post at the transaction rate | changes what the GL derives its figures from — the largest of the four |

Each becomes arguable once the report says how much money is involved. That is the entire theory of
this change: measure first, and let the numbers choose which of the four is worth doing.
