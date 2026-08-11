## Context

Three obligations, three moments, one missing bridge.

```
                  obligation arises          money leaves        bridge
stock receipt     goods delivered            payment             GRNI              ✓
compensation      approval                   settlement          CLAIM_PAYABLE     ✓
vendor purchase   DISB approved              payment             — none —          ✗
```

The third is the one with volume, and its absence is why the ledger recognises expense when cash
moves. Everything needed to close it already exists and was verified against the code rather than
assumed:

- `document_type.accrues_on_approval` exists, and `postAccrualForApproval` already turns an approval
  into `Dr expense / Cr payable`.
- Budget ACTUAL rows exist **at approval** — `PostActionService.cutBudget` settles the reservation
  in the approval transaction — so the accrual has its expense side the moment it runs.
- The seed's `DISB` is already `{ requiresVendor: true, requiresPayee: true, postAction:
  'CUT_BUDGET' }`, which is precisely the shape that should accrue.
- `payment.document_id` is unique: one document is paid exactly once. That is what lets open items
  be derived instead of stored.
- `base_locked` is gross of VAT — `payment.service.ts` computes `netBase = baseLocked −
  baseTaxTotal` for the WHT base, which only makes sense if the former includes tax.

And one thing blocks it: `DocumentTypeService` rejects `accrues_on_approval` together with
`requires_payee`, because both paths would debit the same expense accounts.

## Goals / Non-Goals

**Goals:**

- A vendor obligation appears as a liability when it arises, and disappears when it is paid.
- Expense and input VAT are recognised in the period of the invoice, not the period of the cash.
- Types opt in one at a time, and nothing already approved changes behaviour.
- "Who do we owe" is answerable.

**Non-Goals:**

- Changing when the budget is cut, or cutting it twice. The accrual reads what the budget wrote.
- Partial payments, credit notes, vendor debit notes — none is expressible while `payment` is 1:1
  with `document`.
- Revaluing foreign-currency payables at period end. Named in the proposal as unsupported.
- A vendor subledger table. See D4.

## Decisions

### D1 — The obligation arises at full approval of the disbursement, not at the PO and not at receipt

```
PROC ──────► PO ──────► receipt ──────► DISB ──────► payment
(request)   (order)    (received_qty   (3-way        (cash out)
                        + stock_txn)    matched,
                                        approved)
   │           │            │              │
 RESERVE   commitment   obligation      amount        money
           not a debt   arises          certain       moves
                            ▲              ▲
                       GRNI catches    ◄── AP raised here
                       stock only
```

A PO is a commitment: nothing has been delivered and recognising a liability there would inflate the
balance sheet with orders. Receipt is where the obligation truly arises, and GRNI already catches it
for stock — but **there is no receipt event for a service**, so anchoring on it would cover only the
half already covered. The DISB's approval is where three-way matching has passed, FX is locked, and
`budget_txn` ACTUAL exists; it is also the hook `postAccrualForApproval` already uses.

The cost is stated rather than hidden: services received but not yet invoiced are not accrued, so a
month can close understating both expense and liability. The remedy is an accrued-expense journal at
period close, computable from PO lines with `received_qty` not yet invoiced — which is a period
concern and belongs with periods.

### D2 — The payable role is derived from `document.vendor_id`, not configured

```
document.vendor_id != null  →  ACCOUNTS_PAYABLE
document.vendor_id == null  →  CLAIM_PAYABLE      (unchanged)
```

A `document_type.payable_role` column was considered and rejected: it asks an administrator to
restate something the document already says, and every configuration field is a field that can be
set wrongly — a purchase type quietly crediting `CLAIM_PAYABLE` would put trade debt in a
compensation account with nothing to catch it.

`requires_vendor` is enforced at submit (`document-submit.service.ts:108`), so a type that requires
a vendor always has one by the time it is approved. A type that accrues **without** requiring a
vendor is legitimate — that is what a claim is — and falls to `CLAIM_PAYABLE` by the same rule.

### D3 — The vendor accrual walks the chain; the claim accrual does not

This is the same trap that hid the GRNI defect, in a third function.

```
postAccrualForApproval  reads budget_txn ACTUAL WHERE document = <this document>
cutBudget               writes ACTUAL under the RESERVING document (the PROC/PR)
                        ────────────────────────────────────────────────────────
                        a chained DISB finds nothing, accrues nothing, logs "skipped",
                        and its payment falls through to the old expense path
                        → the whole change silently does nothing
```

The claim path's own-rows rule is correct **for a claim** — its comment says so, and a claim has no
chain. The vendor path must use `settlementActuals`' walk instead. Both keep their own rule rather
than one being generalised into the other, because they are answering different questions: an
accrual belongs to the document that was approved, unless that document is settling somebody else's
reservation.

Third occurrence of "the budget behind a chained settlement line", after `cutBudget` and
`stockPortionByAccount`. If a fourth appears, it should become one helper.

### D4 — Open items are derived, not stored

`payment.document_id` is unique, so a document is paid once and an open payable is exactly:

```
accrued (journal_entry AP_ACCRUAL exists)  AND  not paid (no PAYMENT entry for the same source)

vendor      ← document.vendor_id            amount   ← the AP credit on the accrual
invoice date← journal_entry.entry_date      due date ← entry_date + vendor.payment_term_days
```

Every field is reachable, and the derivation cannot drift from reality because it *is* reality. A
subledger table would be a denormalization to keep in step with the journal, for no question the
journal cannot answer yet.

It becomes necessary when any of these arrives, and not before: partial payments (an open item is no
longer a whole document), credit notes (an open item can be reduced without a payment), or period-end
FX revaluation (an open item needs the currency and amount it was raised in, which
`journal_line` does not carry).

### D5 — One branch in the payment posting is the entire compatibility story

```ts
if (an AP accrual exists for this document) {
  Dr <the payable that accrual credited>   // at base_locked, the rate it was raised at
  Dr/Cr FX for the difference
  Cr WHT_PAYABLE, Cr CASH_CLEARING         // unchanged formula: base_actual − wht
} else {
  ...exactly what it does today...
}
```

Everything else follows from it: types opt in individually, documents approved before the change
settle the old way for the rest of their life, and a company that never enables accrual never
notices. It is also the guard the removed mutual-exclusion rejection used to provide, which is why
it must be tested from both sides before any type is configured to accrue.

Clearing the payable at `base_locked` rather than `base_actual` is not incidental: the payable was
raised at the locked rate, so clearing it at any other rate would leave a residue that the FX line
then has to absorb by accident. Here `AP + fx_delta = base_actual = cash + wht` balances by
construction.

### D6 — VAT and the stock split move to the accrual together

Both are properties of the invoice, not of the cash:

- input VAT's tax point is the invoice date, so debiting `VAT_INPUT` at payment files a December
  invoice in January's return;
- a stock-tracked line's `GRNI` is what the invoice converts into a vendor debt.

Moving them is what makes the payable gross — `base_locked` — which is what is actually owed. The
code that moves was corrected in `clear-grni-when-the-chain-pays-for-stock`; moving it beforehand
would have carried a defect into a harder place to see it, because the payable total would have
looked right with only the debit side wrong.

## Risks / Trade-offs

**Double recognition is the failure mode.** A type that accrues while the payment path still debits
expense charges the same purchase to profit and loss twice. The `if` in D5 is the only thing
preventing it, and the mutual-exclusion rejection that used to prevent it is being removed in the
same change. Both sides of that branch need a test before any type is configured to accrue —
`DISB` in the seed is the first and should be the last until they exist.

**Two ways to be silently wrong, both about the chain.** An accrual that walks own-rows on a chained
document accrues nothing; a payment that cannot find the accrual falls back to expense. Together
they fail *quietly and consistently*, producing exactly the books this change set out to replace.
The undelivered-postings read does not help — nothing failed. Only a chained test catches it, which
is why one is required rather than suggested.

**A period boundary between the accrual and the payment is normal, and is the point.** It also means
the first month after this ships shows expense recognised for invoices approved that month plus
payments of invoices approved before it, with no accrual to clear. Not a defect — the transition —
but worth saying before someone finds it in a variance report.

**GRNI's meaning narrows.** It stops being "goods received not paid" and becomes "goods received not
invoiced", which is what the name says and what it should always have meant. Balances carried before
this change straddle both meanings.

## Migration Plan

An enum value and seed configuration; no table, no backfill. Documents already approved carry no
accrual and settle through the untouched branch, which is the compatibility guarantee rather than a
gap in it.

## Open Questions

- Whether `PO` should ever accrue. It should not — a commitment is not a liability — but the flag
  makes it configurable, and nothing prevents someone setting it. A guard ("only a type that
  requires a payee may accrue to a vendor payable") is arguable; it is left out because a type that
  accrues without a payee is exactly the claim case, and the rule would need an exception
  immediately.
