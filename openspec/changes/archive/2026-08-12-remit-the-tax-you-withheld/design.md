# Design

## D1. One certificate per payment, not per document or per vendor-month

`payment.document_id` is unique and `wht_amount` is stamped on the payment, so the withholding event
is the payment. A certificate is the evidence of one deduction, which is what the payee needs to
claim it.

Per-vendor-monthly certificates would aggregate deductions the payee has to reconcile individually,
and per-document would be the same thing as per-payment with an extra hop.

The row therefore carries `payment_id` unique: a payment withholds once, so it is certified once,
and the uniqueness makes "issued twice" impossible rather than merely unlikely.

## D2. Its own running number, on the same mechanism as a document number

A certificate number is quoted by the payee to a revenue authority; it has to be unique per company
and gapless in practice. `NumberingService.next` already issues those under
`LockMode.PESSIMISTIC_WRITE` on a `doc_running_number` row, which is the concurrency rule this
repository states for numbering.

Reusing that table would mean inventing a `document_type` for something that is not a document. So
the certificate carries its own counter row keyed by company and year, taking the same lock in the
same way — the mechanism is copied, not the table.

## D3. The remittance posts, and the certificates record that it did

The entry is `Dr WHT_PAYABLE / Cr CASH_CLEARING` for the total of the certificates being remitted,
dated the day the money left, keyed `(company, WHT_REMITTANCE, remittanceId)`.

The certificates are stamped with the remittance id rather than the remittance holding a list. A
certificate is the thing that is or is not remitted, and asking "what is still owed to the
authority" is then a query over unstamped certificates rather than a set difference against a
posted total.

**The amount comes from the certificates, not from the account balance.** Clearing `WHT_PAYABLE` by
its balance would clear whatever happens to be sitting there, including a withholding from a period
that is not being filed. Summing the certificates being remitted makes the entry equal to the
filing it accompanies.

## D4. No backdated certificates for payments that already withheld

Payments made before this exists have `wht_amount` and no certificate. The migration does not create
them.

A certificate carries an issue date and a number the payee was given. Generating them now would
produce documents dated today for deductions made months ago, numbered in this year's sequence, that
no payee has ever seen — and the payee may already hold a certificate issued by hand outside the
system. Recording that a certificate exists when it does not is worse than recording nothing.

Those payments' withholding is still in `WHT_PAYABLE`, and still visible as an outstanding balance.
Clearing it is a manual journal voucher — which the system now has — and that is the honest tool for
an obligation discharged outside the process.

## D5. `CASH_CLEARING`, because that is what the payment path already credits

The remittance credits the same role a vendor payment credits. There is no separate "tax payments"
account, and inventing one would create a second cash-shaped account nobody reconciles.

This does mean the remittance shares the concern already noted about `CASH_CLEARING` being mapped
straight to the cash account rather than acting as a clearing account. That is a bank-reconciliation
question and is not resolved here; the remittance simply does not make it worse.
