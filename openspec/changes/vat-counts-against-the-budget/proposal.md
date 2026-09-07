## Why

The budget is charged less than the company pays.

A line of 10.00 USD with a 10% VAT code costs 11.00. At 23,000 kip that is 253,000 leaving the
company — and the budget is cut 230,000. Observed on `REC-HAL-2026-0005`:

```
base_total_amount         253,000   11.00 × 23000   what is paid
budget_base_total_amount  230,000   10.00 × 23000   what the budget is charged
budget_txn ACTUAL         230,000                   what the budget records as spent
```

The 23,000 of VAT is spent from a budget that never sees it. Every VAT-bearing document under-reports
its own consumption, so a budget reads as having room it does not have, and the gap grows with every
document.

That behaviour is deliberate today — `purchase-tax` states it and the submit path implements it — on
the premise that input VAT is reclaimable and therefore not the requesting department's cost. That
premise does not hold here: this company treats VAT as part of what a purchase costs, which is how
the people raising and approving these documents read the figures.

## What Changes

- **BREAKING (behaviour)**: the budget basis becomes tax-INCLUSIVE. A line's
  `budget_base_line_amount` is converted from `line_amount + tax_amount` rather than `line_amount`
  alone, and `budget_base_total_amount` from `grand_total` rather than `sub_total`.
- Nothing new is asked of anyone. The choice already exists per line — a line's `tax_code`. A line
  carrying one now charges the budget for the tax it carries; a line carrying none charges exactly
  what it charges today, because its `tax_amount` is zero. That is what supports both cases without
  a second setting to keep in step with the first.
- Restating a rate uses the same basis, so a document corrected mid-approval and one submitted at the
  corrected rate reserve the same amount.

Deliberately NOT in this change:

- **Documents already submitted.** The basis is stamped at submit and nothing recomputes it, so every
  document in flight keeps the figure it was approved against. This changes what the NEXT submission
  reserves, not what an existing reservation means.
- **A per-company or per-type switch.** Whether VAT is part of a cost is a fact about the company's
  tax position, not a per-document choice, and a flag nobody remembers to set is worse than a rule
  everyone can read. If a second company later needs the reclaimable treatment, that is a
  configuration change made against a stated requirement rather than a guess left in the code.
- **The GL treatment of input VAT.** `VAT_INPUT` is posted from the tax figures, not from the budget
  basis, and is untouched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `purchase-tax`: *VAT on Document Lines* reverses on one point — input VAT now DOES change the
  budget basis, because the company bears it.
- `budget-control`: what a document reserves and settles is the tax-inclusive base.
- `multi-currency`: the budget base stamped at submit is stated as tax-inclusive, so the two bases it
  describes stay distinguishable — the budget base is the cost at the budget rate, the daily base the
  cost at the daily rate.

## Impact

- **Data model**: none. `document_line.tax_amount`, `document.grand_total` and the budget-base
  columns already exist and already hold everything needed.
- **Backend**: four write sites and no more — `DocumentSubmitService` (the line stamp, the document
  stamp, and the `ReserveLine` amounts it builds from the same figure) and `DocumentRateService`
  (the same two stamps when a restatement recomputes them). Every other use reads the stamped value:
  budget settle, approval-band routing, receiving, stock valuation, GRNI, GL accrual.
- **What moves as a consequence**, all coherent under "VAT is part of the cost" and all worth stating
  rather than discovering: a document consumes more of its budget; approval bands compare against the
  larger figure, so a document near a threshold may route to one more approver; stock-tracked lines
  are valued tax-inclusive.
- **Invariants**: 3 and 4 hold — the basis is stamped once and reserve, actual and release all read
  the same stamped figure, so the ledger stays balanced. 2 is untouched: no ledger row changes. 6 is
  untouched: both bases are still stamped at submit and never recomputed from current rates.
