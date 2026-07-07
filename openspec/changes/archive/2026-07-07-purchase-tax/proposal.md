## Why

Document lines are tax-exclusive: `document_line.line_amount = qty × unit_price` with no tax
fields, and the document total carries no VAT. In Thailand/Laos a purchase document is a tax
document — input VAT (7% TH / 10% LA) must be computed and reported, and withholding tax (WHT,
ภ.ง.ด.3/53) must be deducted at payment. Today only `tax_id` (a registration number) is stored;
there is no rate, no tax code, no computation. This change adds the purchase-side tax engine —
VAT on documents and WHT at payment — and posts both to the general ledger built in the
`gl-journal` slice.

This change delivers the **VAT (input) slice first**; withholding tax (WHT) at payment is a
deferred follow-up (it needs payment-flow surgery and is cleanly separable).

- Introduce a company-scoped **tax-code master** (`tax_code`): code, name, `kind` (VAT / WHT),
  `rate`, and `is_active`. Rates are configuration, not code (invariant 7). The `kind` enum
  already includes `WHT` so the follow-up needs no schema churn, but only `VAT` is used here.
- **VAT on documents**: add `document_line.tax_code_id` and a computed line `tax_amount`, and
  document-level `sub_total` / `tax_total` / `grand_total` (+ `base_tax_total` for the GL). VAT is
  computed at submit from the line's tax code; it does **not** change the budget basis (input VAT
  is recoverable — the budget stays on the pre-tax line base, invariant 3).
- **GL integration**: extend the posting engine (new role `VAT_INPUT`) so a settled document
  posts input VAT to the VAT-input account, keeping every entry balanced.
- Add a read-only **tax summary** (input VAT by period) gated by a `TAX_VIEW` permission, and seed
  default Thai VAT codes per company.
- **Out of scope (later slices):** WHT at payment; statutory return generation (PP30, PND3/53);
  output VAT / the sales-AR side; tax-invoice numbering/printing. This slice computes, stores, and
  posts input VAT; it does not withhold or file.

## Capabilities

### New Capabilities
- `purchase-tax`: the tax-code master, VAT computation on document lines + document tax totals,
  the GL posting of input VAT, and the read-only input-VAT summary. (WHT at payment is a deferred
  follow-up under the same capability.)

### Modified Capabilities
- `gl-journal`: the settlement posting SHALL additionally debit input VAT to the `VAT_INPUT`
  account when the settled document carries it, so the entry reflects the tax-inclusive amount
  while remaining balanced.
- `document-engine`: submit SHALL compute per-line VAT from the line's `tax_code` and stamp the
  document's `sub_total` / `tax_total` / `grand_total` (+ `base_tax_total`); the budget
  reserve/actual basis is unchanged (pre-tax line base).

## Impact

- **Data model**: new `tax_code` table; new `account_role` role `VAT_INPUT` (the enum also gains
  `WHT_PAYABLE` for the follow-up but it is unused here); added columns `document_line.tax_code_id`
  + `tax_amount`, `document.sub_total` / `tax_total` / `grand_total` / `base_tax_total`. No change
  to `budget_txn` or the append-only ledgers.
- **Backend**: new `tax` module (tax-code master + VAT computation + summary read); the document
  submit flow calls VAT computation; the GL posting service resolves the `VAT_INPUT` role. Money
  stays a decimal string throughout.
- **Frontend**: a tax-code admin view; a VAT selector on document lines and the tax totals on the
  document; an input-VAT summary view. Shared Zod schemas mirror the DTOs; i18n en + la.
- **Invariants**: preserves all core invariants. Company isolation (#1) covers `tax_code`; VAT
  does not change the budget basis (#3/#4); FX still goes to accounting not the budget (#6); tax
  behavior is config-driven via `tax_code` + `account_role` (#7); authorization by permission
  code (#6). Every GL entry stays balanced (Σdr = Σcr) — the gl-journal invariant.
- **Risk**: rounding of per-line VAT must sum to the document tax total without drift — computed
  with the `Money` decimal helper and rounded to the currency's `decimal_places`; the GL balance
  assert catches any residual before an entry is written.
