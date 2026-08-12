# Design

## D1. One tax point, enforced where the choice is made

Submit refuses `tax_total > 0` on a type that requires a payee and whose `accrues_on_approval` is
false.

The first version of this rule left out `requires_payee` and was too strong: it refused a purchase
requisition carrying a tax code, which the previous change had established is legitimate — a
commitment estimates what a purchase will cost, and nobody has the supplier's invoice when raising
one. A test written for exactly that reddened immediately. The inconsistency only bites where a
document both claims the VAT and is the one being paid, and `requires_payee` is precisely that
distinction; the seed says so — "a disbursement names the account the money goes to; PR stays false
on purpose".

The alternatives all keep two behaviours alive. Posting VAT separately at the invoice date for
non-accruing types splits one document's entry across two dates and two entries, so the ledger no
longer reads as one transaction. Leaving both and reporting the difference tells the reader the
figure is unreliable without giving them a way to fix it. Silently retranslating at report time
would make the report disagree with the ledger, which the tax-report change was written to stop.

Refusing at submit puts the decision in `document_type`, which is where the system already keeps
"how does this kind of document behave" — and it is a decision somebody makes once, not per
document.

The cost is real and stated: a company that wants a cash-basis PAYING type carrying VAT cannot have
one. That is the position the standard takes, and the refusal names it.

## D2. `VAT_RECEIVABLE`, because that is what filing produces

Before filing, input VAT is tax paid on purchases and not yet claimed. After filing it is a debt the
revenue authority owes the company. Those are different assets and the move between them is the
filing.

Keeping it in `VAT_INPUT` and reporting "filed" as a flag elsewhere would leave the account meaning
two things at once, and the balance sheet unable to say how much has been claimed. A second role
costs one seed mapping and makes both figures readable.

## D3. The amount comes from the ledger, for the period

The return's amount is the net movement on `VAT_INPUT` for the period — the same derivation the VAT
summary reports, which the tax-report change moved onto the ledger precisely so that what is filed
and what the books hold cannot differ.

Not the account's balance: a balance includes periods already filed. Not a sum of documents: that is
the second source of truth the tax-report change removed.

## D4. The receivable is where this system's knowledge ends

A refund arriving in the bank, or an offset against output VAT computed elsewhere, are both facts
about money this system does not observe — it has no sales side and no money-in path.

So the change stops at the receivable and says so, rather than inventing a settlement step whose
inputs would have to be typed in by somebody who got them from another system. Clearing it is a
journal voucher, which now exists and goes through a checker.

## D5. Filing is idempotent on the return, and a period is filed once

Keyed `(company, VAT_RETURN, returnId)` like every other posting. A period already filed is refused
by name: a second return for the same month would credit `VAT_INPUT` twice for one claim.
