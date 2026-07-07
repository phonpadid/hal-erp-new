## Context

The VAT slice added the `tax_code` master (kinds VAT | WHT), the `AccountRoleType` values
`VAT_INPUT` / `WHT_PAYABLE`, and the GL settlement posting (Dr expense + Dr VAT_INPUT, Cr cash, FX
line). Payments today record the full base actual amount with no withholding. This slice deducts
WHT at payment: the payer withholds a percentage of the vendor's fee, pays the vendor net, and owes
the withheld amount to the tax authority (a `WHT_PAYABLE` liability). It reuses the tax master, the
role map, and the balanced-entry posting — only the payment record and the GL credit side change.

## Goals / Non-Goals

**Goals:**
- Select a WHT `tax_code` when recording a payment; compute `wht_amount` on the document's pre-VAT
  net base; pay the vendor net of WHT; store `wht_amount` + `wht_tax_code_id` on `payment`.
- Extend the GL settlement entry to credit `WHT_PAYABLE` and reduce the cash credit, staying balanced.
- Seed default Thai WHT codes + the WHT-payable account and role mapping.
- Add WHT to the read-only tax summary.

**Non-Goals:**
- No per-vendor WHT default this slice: `vendor` is a group-wide master (no `company_id`), so a
  per-company default belongs on `vendor_company` — deferred. WHT is chosen at payment time.
- No WHT certificate or PND3/53 form/e-filing generation.
- No output/sales-side withholding.
- No change to the budget: WHT is an accounting deduction, not a budget movement (invariant 6).

## Decisions

**1. WHT base is the pre-VAT net, in base currency.**
`net_base = base_locked − base_tax_total` (base_locked = grand = net + VAT; base_tax_total is the VAT
in base). `wht_amount = round(net_base × wht_rate, decimal_places)`. This matches the common Thai/Lao
service-WHT rule (withhold on the fee, not on VAT). The rule lives only in `PaymentService.record`, so
a future regime change is one edit.

**2. WHT is chosen at payment, validated to kind = WHT.**
`RecordPaymentDto` gains an optional `whtTaxCodeId`. `record()` resolves it in the active company and
rejects a code whose `kind` is not `WHT`. No code → `wht_amount` 0 and the full base actual is paid
(backward compatible with every existing payment).

**Sequence — record payment (writes `payment`, never `budget_txn`):**
1. `record(documentId, actualRate, whtTaxCodeId?)` runs in its existing `inTransaction`.
2. Compute `base_actual` and FX as today; then resolve the WHT code (if any), compute `wht_amount`
   on `net_base`, and persist it on the `Payment` row alongside the FX breakdown.
3. Commit; emit `payment.settled` (unchanged payload) — the GL reads `payment.wht_amount` directly.
No `budget_txn` or `quota_usage` is written here (invariant 6); no new lock is needed — the payment
row is already guarded one-per-document.

**3. GL settlement entry extended, still balanced.**
On `payment.settled` the posting engine now builds:
- Dr expense account(s) at `Σ ACTUAL` (pre-tax net) — unchanged.
- Dr `VAT_INPUT` at `document.base_tax_total` when non-zero — from the VAT slice.
- Cr `WHT_PAYABLE` at `payment.wht_amount` when non-zero — new.
- Cr cash-clearing at `base_actual − payment.wht_amount` (net cash paid) — adjusted from `base_actual`.
- FX line for `fx_delta` — unchanged.
Balance holds: `Dr = net + VAT = grand = base_locked`; `Cr = (base_actual − wht) + wht = base_actual`;
`base_actual = base_locked + fx_delta`, closed by the FX line. The existing Σdr = Σcr assert fails the
posting (logged, retryable) rather than writing an unbalanced entry.

**4. WHT_PAYABLE resolved by role, seeded per company.**
Like the other system accounts, `WHT_PAYABLE` resolves via the `account_role` map. Seed adds a
`2100 WHT Payable` liability account and the mapping; a missing mapping makes the posting a logged
no-op (retryable) without affecting the committed payment.

## Risks / Trade-offs

- **[WHT base gross vs. net of VAT]** → Fixed to the pre-VAT net (`base_locked − base_tax_total`) in
  one place; documented and unit-tested.
- **[A payment predating this change / no WHT code]** → `wht_amount` defaults to 0, cash = base
  actual, and the settlement entry omits the WHT line — fully backward compatible.
- **[Rounding leaves Σdr ≠ Σcr]** → All math uses the `Money` decimal helper at the currency
  `decimal_places`; the WHT credit and the reduced cash credit are complementary by construction, and
  the balance assert catches any residual before persisting.
- **[Wrong tax-code kind passed]** → `record()` rejects a non-`WHT` code, so a VAT code can't be used
  as a withholding rate.
