# Remit the tax you withheld

## Why

`WHT_PAYABLE` is credited every time a payment withholds tax, and **no code anywhere debits it**.
The account grows for the life of the system, and the balance sheet reports a liability the company
has in fact been discharging every month.

That is the accounting half. The legal half is worse: a company that withholds tax owes the payee a
withholding certificate for each deduction, and owes the revenue authority the money. This system
records the deduction, pays the vendor net, and then has no way to issue the certificate or to
record the remittance. Both obligations exist the moment `payment.wht_amount` is stamped, and the
system's involvement ends there.

## What Changes

**The certificate.** A `wht_certificate` table, one row per payment that withheld, carrying its own
running number per company and year, the payee, the tax code and rate, the base and the amount, and
the date issued. Issued from the payment that withheld, once, and never edited — a certificate the
payee holds is not a draft.

**The remittance.** An operation that settles the certificates of a month: it posts
`Dr WHT_PAYABLE / Cr CASH_CLEARING` for their total, stamps the certificates with the remittance,
and is idempotent on `(company, WHT_REMITTANCE, remittanceId)` like every other posting.

**The read.** The certificates of a period and their total, so the figure filed and the figure
remitted come from the same place — and, being derived from the ledger's own rows rather than
recomputed, cannot disagree with the payable being cleared.

## What This Change Does NOT Do

- **No VAT settlement.** An earlier note of mine claimed input VAT and withheld tax are cleared by
  the same monthly act. That was wrong: they are separate filings with separate due dates, and input
  VAT is cleared by offsetting **output** VAT, which this system does not have — it has no sales
  side at all. Whether `VAT_INPUT` is discharged by a refund claim, an offset computed elsewhere, or
  expensed is a decision that needs information this system does not hold, and inventing an answer
  in a change about withholding would be the wrong place to guess.
- No tax-authority form generation. The figures are produced; the filing is a document a person
  submits.
- No certificate cancellation. A certificate is issued from a payment, and a payment that should not
  have withheld is corrected by reversing its posting — which is a change of its own.

## Impact

- Affected specs: `purchase-tax`
- Affected code: a new `wht_certificate` entity + migration + DBML, `tax.service.ts` or a new
  service beside it, `gl-posting.service.ts` for the remittance entry, controller, DTOs; frontend
  api/store/view and i18n.
- Migration: one new table. No data change — payments that withheld before this have no certificate
  and are not given a backdated one. See design D4.
