## Why

A disbursement raised in the company's own base currency has no exchange rate to state — it is paid in
the money the books are kept in, so its rate is 1 by definition. Nothing enforces that today: the only
check on an actual rate is that it is positive. On 2026-09-22 a slip was attached to `RECBL-HAL-2026-0021`
(a LAK document, locked rate 1) stating an actual rate of 695, as if the figure were Thai baht. The
document's own rate was later corrected to 1, which did not clear the figure already on the slip, and at
settlement on 2026-09-24 the payment restated 21,000,000 LAK as 14,595,000,000 and booked the
14,574,000,000 difference to FX loss. The entry balanced, so nothing complained: that single typo is 93.7%
of every expense in the general ledger, and the September income statement cannot be used until it is
reversed.

The budget ledger was never wrong — it charged 21,000,000 at the document's own basis — which is exactly
why this went unseen: the two ledgers disagreed and only the one nobody reconciles daily was wrong.

## What Changes

- An actual exchange rate other than `1` is **refused** for a document whose currency is the posting
  company's base currency, at every point one can be stated or consumed: attaching a slip, restating a
  slip's rate, recording a payment, and the settlement that computes the FX difference.
- The refusal is enforced at the settlement choke point as well as at input, so a rate stated while the
  document was still in a foreign currency cannot survive a later correction of that currency and be
  consumed anyway. This is the hole the September entry actually went through.
- The web disables the actual-rate field for a base-currency document and shows `1`, on the
  ready-to-pay dialog and on the payment-batch result rows. The client guard is UX; the server still
  enforces.
- No migration, no schema change, and no change to how a genuine foreign-currency payment behaves: a USD
  document still locks its rate at submit, still restates at payment, and still books the difference.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `payment-handoff`: a new requirement that the actual rate of a base-currency document is 1, binding on
  the slip, the recorded payment and the settlement restatement.
- `web-payments`: the actual-rate input is disabled and fixed at 1 for a base-currency document.

## Impact

- `back/src/modules/payment-handoff/payment-attachment.service.ts` — slip attach and `stateRate`.
- `back/src/modules/payment-handoff/payment.service.ts` — `actualRate` validation and the
  `input.actualRate ?? rateOnSlip` resolution that feeds `baseActual`.
- `front-end/src/views/payments/ReadyToPayView.vue`, `PaymentBatchDetailView.vue` — the rate input.
- No invariant is weakened. Invariant 6 (locked FX, gain/loss to accounting) is unchanged for documents
  that actually carry foreign currency; this change only denies a second currency basis to documents that
  have none. Existing rows are untouched: the September entry is corrected by reversal through
  `gl-journal`, not by this change.
