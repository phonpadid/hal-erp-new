## Why

The purchase-tax slice computes input VAT on documents but stops there: withholding tax (WHT,
ภ.ง.ด.3/53) — which Thai/Lao payers must deduct from a vendor payment and remit — is not handled.
Payments are recorded at the full base actual amount with no WHT. The groundwork is already in
place from the VAT slice: the `tax_code.kind` enum includes `WHT`, and the `AccountRoleType` enum
includes `WHT_PAYABLE`. This change completes purchase-tax by deducting WHT at payment and posting
the WHT-payable liability to the general ledger.

## What Changes

- **WHT at payment**: a WHT `tax_code` selected when recording a payment. The system computes
  `wht_amount` on the document's pre-VAT net base, pays the vendor **net of WHT**, and stores
  `wht_amount` + `wht_tax_code_id` on the `payment`.
- **GL integration**: extend the settlement posting so a settled document with WHT credits the
  `WHT_PAYABLE` account for `wht_amount` and credits cash-clearing for the actual base **net of
  `wht_amount`**, keeping the entry balanced (Σdebit = Σcredit).
- **Master + seed**: seed default Thai WHT codes (`WHT3` 0.03, `WHT5` 0.05) and the `WHT_PAYABLE`
  `account_role` mapping (adding a WHT-payable liability account to the chart). The tax-code admin
  already manages both VAT and WHT kinds — no new admin surface.
- **Read**: extend the tax summary with WHT by period (alongside the existing input-VAT summary).
- **Out of scope (later):** a per-vendor WHT default (belongs on the per-company `vendor_company`,
  not the group-wide `vendor`); WHT certificates and PND3/53 form/e-filing generation; the sales /
  output side.

## Capabilities

### New Capabilities
<!-- None. WHT extends the existing purchase-tax capability. -->

### Modified Capabilities
- `purchase-tax`: add the WHT-at-payment behavior (compute `wht_amount` on the net base, pay net,
  store on `payment`) and WHT in the tax summary.
- `payment-handoff`: recording a payment SHALL accept an optional WHT `tax_code`, compute and store
  `wht_amount`, and pay the vendor net of WHT.
- `gl-journal`: the settlement posting SHALL credit `WHT_PAYABLE` for `wht_amount` and reduce the
  cash-clearing credit to the actual base net of `wht_amount`, remaining balanced.

## Impact

- **Data model**: added columns `payment.wht_amount` + `wht_tax_code_id` (DBML + migration). New
  seeded WHT tax codes, a WHT-payable account, and the `WHT_PAYABLE` role mapping. No change to
  `budget_txn` or the append-only ledgers; the `tax_code` / `account_role` schemas are unchanged
  (the enum values already exist).
- **Backend**: `PaymentService.record` gains an optional WHT tax code, computes `wht_amount` via the
  `TaxService`/`Money` helpers, and stores it; `RecordPaymentDto` gains `whtTaxCodeId`. The GL
  posting service resolves `WHT_PAYABLE` and adjusts the cash credit. The tax summary read adds WHT.
- **Frontend**: the payment (record) form gains a WHT tax-code Select and shows the net-of-WHT cash
  amount; the tax summary view adds a WHT-by-vendor/period section. Shared schema + i18n en + la.
- **Invariants**: preserves all core invariants. WHT writes no `budget_txn` (invariant 6 — it is an
  accounting deduction, not a budget movement); company isolation (#1) and permission-code
  authorization (#6) are unchanged; the tax rate is config via `tax_code` (#7); every GL entry stays
  balanced (Σdr = Σcr).
- **Risk**: WHT base ambiguity (gross vs. net of VAT) — fixed to the pre-VAT `sub_total` base (the
  common Thai/Lao service-WHT rule), computed once with the `Money` decimal helper and rounded to the
  currency's `decimal_places`; the GL balance assert catches any residual drift.
