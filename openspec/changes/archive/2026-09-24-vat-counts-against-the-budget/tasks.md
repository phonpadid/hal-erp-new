## 1. The budget basis includes the tax

- [x] 1.1 `DocumentSubmitService`: stamp `budget_base_line_amount` from `line_amount + tax_amount`
      and `budget_base_total_amount` from `grand_total`
- [x] 1.2 The same figure in the `ReserveLine` amounts, so what is stamped and what is reserved are
      one number and not two derivations of it
- [x] 1.3 `DocumentRateService.restate`: the same two stamps, so a document corrected mid-approval
      and one submitted at the corrected rate reserve the same amount

## 2. Tests

- [x] 2.1 A taxed line reserves its tax-inclusive base; the existing pre-tax assertion in the
      purchase-tax suite is updated with a comment saying why it flipped. The suite keeps its own
      rate fixture — the rule is rate-agnostic and must not start depending on 10%
- [x] 2.2 An untaxed line reserves exactly what it did before — the case that makes one rule cover
      both
- [x] 2.3 A mixed document charges each line for its own tax
- [x] 2.4 Reserve, actual and release all read the same stamped figure, leaving nothing outstanding
- [x] 2.5 A restatement reserves the same amount a fresh submit at that rate would
- [x] 2.6 The WHT base is still pre-VAT — the assertion that keeps this change inside its own lane

## 3. Verification

- [x] 3.1 Backend and frontend suites, `tsc -p tsconfig.build.json` and `vue-tsc -b` — backend
      2118 passed, frontend 1121 passed, both typechecks clean
- [x] 3.2 On a real taxed document: confirm `budget_txn` RESERVE equals the tax-inclusive base, and
      that a document already in flight settles the figure it reserved — REC-HAL-2026-0006 reserved
      and settled 253,000 (11.00 tax-inclusive), while REC-HAL-2026-0003, submitted before the
      change, still carries its pre-tax 130,000 basis untouched
