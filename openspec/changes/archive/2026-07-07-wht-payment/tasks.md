## 1. Data model & migration

- [x] 1.1 Add `payment.wht_amount decimal(15,2)` (default 0) and `payment.wht_tax_code_id` (nullable FK to `tax_code`) to `erp_approval_system.dbml`.
- [x] 1.2 Add `whtAmount` + `whtTaxCode` to the MikroORM `Payment` entity.
- [x] 1.3 Generate the migration (add the two columns + FK) and verify it applies cleanly.

## 2. Backend: WHT at payment

- [x] 2.1 Add `TaxService.computeWht(netBase, whtRate, decimalPlaces)` (round via the `Money` helper) and a `resolveWht(taxCodeId)` that loads an active `WHT`-kind code in the active company and rejects a non-WHT kind.
- [x] 2.2 Extend `RecordPaymentDto` with an optional `whtTaxCodeId` (UUID) and thread it through the controller to `PaymentService.record`.
- [x] 2.3 In `PaymentService.record`, when a WHT code is given: compute `net_base = base_locked − base_tax_total` (read `document.base_tax_total`), compute `wht_amount`, and persist `wht_amount` + `wht_tax_code` on the `Payment`. No WHT code → `wht_amount` 0.

## 3. Backend: GL posting

- [x] 3.1 Extend `GlPostingService.postForPayment`: when `payment.wht_amount` > 0, add a Cr `WHT_PAYABLE` line (resolve the role) and reduce the cash-clearing credit to `base_actual − wht_amount`; keep the Σdebit = Σcredit assert.

## 4. Backend: tax summary

- [x] 4.1 Extend the `TAX_VIEW` tax summary read to include withheld WHT by period (sum `payment.wht_amount`), company-scoped and read-only.

## 5. Seed

- [x] 5.1 Seed default Thai WHT codes per company (`WHT3` 0.03, `WHT5` 0.05), a `2100 WHT Payable` liability account, and the `WHT_PAYABLE` `account_role` mapping.

## 6. Frontend

- [x] 6.1 On the payment (record) form, add a WHT tax-code Select (active WHT codes) and show the net-of-WHT cash amount to be paid.
- [x] 6.2 Extend the tax summary view with a WHT-by-period section; add a WHT selectable API + store action.
- [x] 6.3 Add i18n keys (en + la) for the WHT selector, net-of-WHT label, and the WHT summary.

## 7. Tests

- [x] 7.1 Unit: `computeWht` rounds correctly; `resolveWht` rejects a non-WHT-kind code.
- [x] 7.2 Unit: `record` with a WHT code stores `wht_amount` on the net base and reports the net cash; no WHT code → `wht_amount` 0 and full base actual.
- [x] 7.3 Unit: WHT base excludes VAT — a document with VAT withholds on the pre-VAT net.
- [x] 7.4 Unit: GL posting for a VAT+WHT settlement debits expense + VAT_INPUT and credits cash (net of WHT) + WHT_PAYABLE, balanced (Σdebit = Σcredit).
- [x] 7.5 Unit: a settlement with no WHT omits the WHT_PAYABLE line (backward compatibility).
- [x] 7.6 Frontend: the payment form WHT select computes and shows the net-of-WHT amount.
