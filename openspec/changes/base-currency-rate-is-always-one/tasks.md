## 1. The rule, in one place

- [x] 1.1 Add `assertRateFitsCurrency(docCurrencyCode: string | undefined, baseCurrencyCode: string, rate: string | undefined)` to the payment-handoff module: a no-op when the rate is undefined or the document is foreign-currency, and a `BadRequestException` naming the document's currency and the offending figure when the document is base-currency (code equal to the base, or null) and the rate is not exactly 1.
- [x] 1.2 Unit-test the predicate directly: null currency, base code, foreign code, rate `1`, `1.00000000`, `695`, and undefined.

## 2. Backend enforcement

- [x] 2.1 `payment-attachment.service.ts` — call it in `attach()` beside the existing positivity check, before anything is stored.
- [x] 2.2 `payment-attachment.service.ts` — call it in `stateRate()` before `rates.restate`.
- [x] 2.3 `payment.service.ts` — call it in `record()` on the RESOLVED rate (`input.actualRate ?? rateOnSlip`), after the fallback and before `baseActual` is computed, so a rate adopted from a slip is checked too.
- [x] 2.4 Load the document's currency and the company's base currency in `record()` from the rows it already reads, not with a second query per payment.

## 3. Tests

- [x] 3.1 Service test: a slip stating 695 on a LAK document is refused and no `payment_attachment` row exists.
- [x] 3.2 Service test: `stateRate` on a base-currency document is refused and `document.exchange_rate` is unchanged.
- [x] 3.3 DB-backed test reproducing the September failure: a document whose slip states 695 and whose currency is then the base currency is refused at `record()`, with no `payment` row and no `journal_entry` written.
- [x] 3.4 Regression test: a USD document at locked 22,000 records at 22,650, `base_actual` and `fx_delta` unchanged from today's behaviour.
- [x] 3.5 A base-currency document recording at rate 1, and one recording with no rate at all, both settle with `fx_delta` zero.

## 4. Web

- [x] 4.1 `ReadyToPayView.vue` — disable the rate input and show `1` when the document's currency is the base currency, with a one-line reason beside it.
- [x] 4.2 `PaymentBatchDetailView.vue` — same for the per-row rate cell; the row still submits `1`.
- [x] 4.3 Component tests for both: disabled for a base-currency row, editable for a foreign-currency row.

## 5. Check the existing data

- [x] 5.1 Run against production (read-only) and report the rows: `SELECT d.doc_no, d.status, d.currency, d.exchange_rate, a.actual_rate FROM payment_attachment a JOIN document d ON d.id = a.document_id WHERE a.actual_rate IS NOT NULL AND (d.currency IS NULL OR d.currency = 'LAK') AND a.actual_rate <> 1;` — on the 2026-10-08 snapshot this is `RECBL-HAL-2026-0021` alone.
- [x] 5.2 Do NOT repair any row in this change. The September entry is corrected by a reversal through the journal-voucher route, by accounting.

## 6. Done

- [x] 6.1 `pnpm build` in shared, back and front; full backend and frontend suites green before any push.
