# Close the loop on input VAT

## Why

Two gaps this work opened and named, and they are the same gap seen from either end.

**`VAT_INPUT` is debited and never credited.** It is the last one-sided account on the balance
sheet: the withholding side was closed by the remittance, and this was left because clearing input
VAT means knowing what it is cleared against, and this system has no sales. So the asset grows for
the life of the company — money the company in fact recovered every filing period, reported as still
owed to it.

**The tax point is inconsistent.** A document type that accrues on approval debits `VAT_INPUT` at
the invoice, which is the tax point. One that does not debits it at payment. Two documents with the
same supplier invoice date fall in different returns depending on a `document_type` flag set for an
entirely unrelated reason — so the figure being filed depends on configuration nobody chose for tax
purposes.

The second makes the first unfilable: a return computed from a ledger whose tax points disagree is a
return that cannot be defended.

## What Changes

**The tax point becomes the invoice, always.** Submit refuses a document that carries VAT and whose
type does not recognise the expense at approval. Claiming input VAT on a cash basis is not a
position a VAT-registered accrual-basis company holds, and pushing the choice into `document_type`
puts it where configuration belongs (invariant 7) rather than leaving two behaviours side by side.

**Filing a return clears the period's input VAT.** A `vat_return` records the period filed, the
input VAT claimed — taken from the ledger, which the tax-report change made the authority — and
posts `Dr VAT_RECEIVABLE / Cr VAT_INPUT`. The asset moves from "input tax accumulated" to "owed to
us by the revenue authority", which is what filing does.

## What This Change Does NOT Do

- **Does not settle the receivable.** How the authority discharges it — a refund into the bank, an
  offset against output VAT computed in another system — is a fact this system does not hold. The
  receivable is where its knowledge ends, and the last hop is a journal voucher, which exists.
- No output VAT. There is no sales side, and inventing one to make the arithmetic look complete
  would be worse than stopping where the facts stop.
- No change to how input VAT is computed or to the rate on a document.

## Impact

- Affected specs: `purchase-tax`, `document-engine`
- Affected code: `common/enums` (`VAT_RECEIVABLE`), a `vat_return` entity + migration + DBML,
  `document-submit.service.ts`, a return service and controller, seed; frontend api/store/view,
  i18n, smoke.
- Migration: one new table. Existing documents are unaffected; the submit rule applies to new
  submits only.
