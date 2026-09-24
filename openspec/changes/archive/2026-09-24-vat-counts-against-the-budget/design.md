## Context

The budget basis is stamped once, at submit, and read everywhere afterwards. `DocumentSubmitService`
computes `budgetToBase(l.lineAmount)` per line and `budgetToBase(total)` for the document, where
`total` is the pre-tax line sum. Eleven places then read those stamped columns; only four write them
(two in submit, two in `DocumentRateService.restate`).

Input VAT is excluded from that basis today, and the exclusion is written down — `purchase-tax` says
"Input VAT SHALL NOT change the budget basis" with a scenario asserting 1000 rather than 1070. The
premise is that input VAT is reclaimable, so it is the tax authority's money passing through rather
than the department's cost.

That premise is the thing that has changed. This company bears the VAT, so a purchase of 10.00 with
10% tax costs it 11.00, and a budget charged 10.00 is a budget that has already spent money it still
reports as available.

## Goals / Non-Goals

**Goals:**

- Charge a budget what the purchase actually costs the company.
- Support taxed and untaxed lines in one rule, with no new setting to configure or forget.
- Leave every document already submitted exactly as it is.

**Non-Goals:**

- Recomputing the basis of documents in flight. What a reservation means is what it meant when taken.
- A per-company or per-document-type switch for the reclaimable treatment.
- Changing how input VAT is posted to the GL, or the WHT base (which stays pre-VAT).

## Decisions

### D1 — The line's tax code IS the switch; no second one is introduced

"Support both with and without VAT" is already expressed, per line, by whether the line names a
`tax_code`. Making the basis tax-inclusive costs an untaxed line nothing, because its `tax_amount` is
zero, so one rule covers both:

| line | tax_amount | budget basis before | after |
|---|---|---|---|
| net 1000, VAT 10% | 100 | 1000 | **1100** |
| net 500, no tax code | 0 | 500 | 500 |

The rate is the line's `tax_code`, never a constant: this deployment's company runs a single `VAT10`
code at 10%, the seeded demo company a `VAT7` at 7%, and the arithmetic is identical for both.

*Alternative rejected:* a `document_type.vat_in_budget` flag, or a company setting. Whether input VAT
is a cost is a fact about the company's tax position, not something to decide per document — and a
flag that must agree with the tax configuration is a second place for the truth to live and drift.
If a company ever needs the reclaimable treatment, it should arrive as a stated requirement with its
own scenarios, not as a default nobody set deliberately.

### D2 — Change only where the basis is WRITTEN

Four sites compute it; everything else reads the stamped column and therefore follows without being
touched: budget settle (`post-action.service.ts`), approval-band routing
(`workflow-step.resolver.ts`), receiving, stock movement, GRNI, and the GL accrual for stock-tracked
lines.

That is also what makes "does not disturb what is running" true structurally rather than by care: a
document already submitted holds a stamped figure that this change never revisits.

### D3 — What follows from the premise, stated rather than discovered

Because the readers follow the stamp, making it tax-inclusive also means:

- **Approval routing** compares bands against a larger figure, so a document near a threshold may
  route to one more approver. Correct under the premise — the approver's band is about how much the
  company is committing, and it is now committing the tax too.
- **Stock-tracked lines are valued tax-inclusive.** Also correct under the premise: non-reclaimable
  input VAT is part of the cost of the goods, which is exactly how inventory should carry it.
- **A budget covers fewer purchases than before.** That is the defect being fixed, seen from the
  other side: the room it appeared to have was room the tax had already taken.

### D4 — Restating a rate uses the same basis

`DocumentRateService.restate` recomputes both bases when no `BUDGET_RATE` governs. It must convert
from the same tax-inclusive amounts, or a document corrected mid-approval would reserve a different
figure from an identical one submitted at the corrected rate — two paths, one document, two answers.

### Budget, quota, and transaction boundaries

No change to any boundary. The same transaction stamps the same columns and takes the same holds
under the same locks; only the figure converted is different. No `quota_usage` involvement — a quota
is counted in units, and tax does not change how many of something was asked for.

## Risks / Trade-offs

- **A budget mid-year now holds a mix of pre-tax and tax-inclusive reservations** → unavoidable
  without restating documents in flight, which would be worse. Both are correct as at their submit,
  the ledger stays balanced because each document settles what it reserved, and the mix works itself
  out as the older documents complete.
- **A document that fitted its budget yesterday may not today** → that is the point; the refusal is
  the budget telling the truth about what is left. It surfaces through the existing over-limit policy
  with its existing message, not a new failure mode.
- **A document near an approval band gains an approver** → correct under the premise, and visible:
  the route is resolved and recorded at submit, so the document shows the chain it actually ran.
- **The WHT base must stay pre-VAT** → untouched by this change; it is computed from
  `base_locked − base_tax_total` in the payment path, and a test pins it.

## Migration Plan

1. Ship the four write sites. Nothing recomputes, so nothing already submitted moves.
2. New submissions reserve tax-inclusive from that moment. The first taxed document shows the
   difference in its own `budget_txn` row.
3. No data migration and no backfill: restating historic reservations would rewrite what people
   approved.
4. Rollback is the reverse code change, with the same property — documents submitted while it was
   live keep their stamped basis and settle it correctly.

## Open Questions

- Should a report show, per budget, how much of its consumption is tax? Useful the day the company's
  VAT position changes, and not needed to make this correct — left out until somebody needs it.
