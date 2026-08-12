# Revalue what we owe

## Why

A payable in a foreign currency is carried at the rate it was raised at, for as long as it is
unpaid. The rate stamped on the document at submit is deliberately never recomputed (invariant 6) —
that is right for the budget and for the approval it passed, and wrong for the balance sheet.

A supplier owed 1,000 USD in March, when the rate was 34, is reported at 34,000 in December, when
it costs 35,000 to pay them. The liability is understated by the entire currency movement, and the
loss appears only when the payment settles — in a period that has nothing to do with when the
currency moved.

The standard is unambiguous: monetary items in a foreign currency are retranslated at the closing
rate at each reporting date, and the difference goes to profit or loss. This system reports at
period close and has the rate machinery, the FX accounts and the payable — it never retranslates.

## What Changes

- Closing a period revalues the open payables whose document is in a foreign currency, at the
  **closing rate for the period end**, and posts the difference to `FX_GAIN` or `FX_LOSS` against
  `ACCOUNTS_PAYABLE`.
- The reversal is posted in the same operation, dated the day after the period ends — exactly as the
  received-not-invoiced accrual already is, and for a stronger reason: without it every subsequent
  payment would strand the revaluation in the payable. See design D3.
- A missing closing rate REFUSES the close, naming the currency pair. It does not fall back.

## What This Change Does NOT Do

- **No revaluation of anything but trade payables.** `CLAIM_PAYABLE` is owed to a person in the
  company's own money; `ACCRUED_EXPENSE` already carries its own reversal and revaluing it would
  double-count; cash and receivables do not exist here in foreign currency.
- No revaluation outside a period close. Retranslation is a reporting-date act, and the reporting
  date in this system is the period end.
- No change to the locked rate on a document, to the budget basis, or to what a payment posts.
  Revaluation is a balance-sheet correction that unwinds itself; the realised difference at payment
  is still `fx_delta`, computed as it always was.

## Impact

- Affected specs: `accounting-period`
- Affected code: a revaluation service beside `ReceivedNotInvoicedService`,
  `accounting-period.service.ts` (one more step in `close`), `gl-posting.service.ts` for the two
  source types.
- No migration. No new table — the document already carries its currency, its locked rate and its
  foreign amount, so an `ap_open_item` table is not needed.
