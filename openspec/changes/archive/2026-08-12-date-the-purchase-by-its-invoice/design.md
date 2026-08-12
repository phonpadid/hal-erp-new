# Design

## D1. The invoice date is a document field, not a payment field

The tax point belongs to the purchase, not to the settlement of it. A document may be paid late, in
instalments in some other system, or not at all; its input VAT is claimable from the invoice
regardless. Putting the date on `payment` would make the tax point depend on an event that has not
happened yet.

It is also where the number has to live. `payment.document_id` is unique — one payment per document
— so a payment-side field would be no more granular, and the accrual that recognises the VAT runs
long before any payment row exists.

## D2. Required where the VAT is actually claimed, not wherever tax appears

`vendor_invoice_no` and `vendor_invoice_date` are nullable columns and a submit-time requirement on
documents that carry VAT **and** whose type sets `accrues_on_approval`.

The first draft of this rule was `tax_total > 0` alone, on the reasoning that a document claiming
input VAT must name its invoice whatever type it is. Two existing tests failed and were right to:
a purchase requisition carries a tax code to estimate what a purchase will cost, and nobody has the
supplier's invoice when raising a requisition. The seeded chain says so in as many words — the
disbursement IS the accepted invoice, while a PR and a PO are commitments, not liabilities.

`accrues_on_approval` is not a second rule bolted on. It is exactly the set of documents whose
accrual posts `VAT_INPUT` and is dated by the invoice (D3), so the requirement asks for the data
precisely where the system consumes it. A type that does not accrue never reads the invoice date,
and demanding it there would be collecting a field to leave unused.

Nullable on the column because most document types are not purchases at all: a leave request, a
promotion. Requiring an invoice number on those would be a field to invent a value for, and invented
values are worse than absent ones.

## D3. Dated on the invoice, falling back to the approval when that month is closed

The accrual entry is dated `vendor_invoice_date`. That puts expense, payable and input VAT on the
tax point together, in one entry, which is what a purchase entry is.

A late invoice is ordinary: dated the 28th, approved on the 3rd, and November closed on the 1st.
`createEntry` refuses a closed period, correctly — so dating strictly by the invoice would put the
posting in the undelivered queue, where it would block the next close and could only be resolved by
reopening a reported month. That is a worse answer than a slightly late claim.

So: the invoice date when its period is open, the approval date when it is not, and the memo says
which was used. Claiming input VAT in a later period than the invoice is permitted in practice; a
month that cannot be closed is not.

`PeriodGuardService.closedPeriodOn` already answers the question, so the fallback asks the same
component the guard asks rather than deriving "is this month closed" a second time.

**Rejected: always the approval date.** It is the date a workflow completed, which is not an
accounting fact about the purchase. **Rejected: a `document_date` column on `journal_entry`.** It is
the right general answer and it is a larger change; the fallback covers the case that forces it, and
the column should arrive with the VAT return that reads it.

## D4. The stale rule is corrected where it is written, not enforced

Two documents say `accrues_on_approval` and `requires_payee` must not be combined. The code does not
enforce it, the seed ships the combination on `DISB`, and the posting engine has a comment
explaining why it is now safe — the payment clears the payable rather than re-debiting expense.

The rule is obsolete, not unenforced. So the fix is to correct both statements, not to add a
validator that would reject the reference configuration.

This is included here rather than split out because this change is about when a purchase's expense
and tax are recognised, and the stale rule is a claim about exactly that. A validator added by
somebody trusting the note would break every disbursement in the seeded configuration.

## D5. The form gates the fields the way it gates the payee

`CreateDocumentView` already carries first-class header fields — vendor, payee account — shown and
required by the selected type's flags, with the submit-time check mirrored on the client.

The invoice fields follow that shape, gated on the document carrying tax rather than on a type flag
(D2). The client check is UX; the server refuses a submit that claims VAT without naming its
invoice, as it refuses one missing a payee.
