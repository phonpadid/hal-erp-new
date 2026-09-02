# Pay every payee through one path

## Why

Money leaves this company through two mechanisms that do the same thing, and the second one is a
copy of a generic path the first already has.

Every ERP that has solved this converges at the same place. The OBLIGATION is allowed to differ —
a vendor invoice, an employee claim, a compensation to a customer are different documents raised by
different people for different reasons. The PAYMENT is not, because every control worth having hangs
off the payment and not off its origin: the ageing, the bank reconciliation, the evidence rule, the
segregation of duties, the withholding. SAP registers an employee as a vendor master record and pays
it through the same run. Oracle calls both a Payee. Odoo turns an expense into the same `account.move`
a bill produces. Xero and QuickBooks put everything on one "Bills to Pay".

This system splits at both layers, and the second split earns nothing:

```
  obligation                       payment
  ──────────                       ───────
  vendor invoice   ─────────────▶  payment              ✓ correct to split here
  claim / comp.    ─────────────▶  document_settlement  ✗ nothing here is different
```

**The settlement path duplicates a branch that is already generic.** `accruedPayable` reads the
account off the accrual's own credit line — `credits[0].account`, whatever it happens to be. It
clears `CLAIM_PAYABLE` exactly as willingly as `ACCOUNTS_PAYABLE`. `postSettlementClearing` is a
second implementation of a function that already handles its case.

**On a fresh install the path cannot write anything.** The seeded document types are `PR`, `PROC`,
`PO`, `DISB`, `PROMOTE`, `RESIGN`, `ISSUE`, `STOCK_ADJ`, `STOCK_XFER`. Only `DISB` accrues, and it
carries a vendor, so it raises a trade payable. `CLAIM_PAYABLE` is not among the twelve seeded
account roles. Nothing can produce a settlement.

**What the settlements queue does instead is show the wrong documents.** It filters on
`accrues_on_approval` alone, so the seeded `DISB` — which is `CUT_BUDGET` **and** accrues — appears
in both queues at once. Acting on it there uploads an evidence file to object storage and then
throws an unhandled error, because the accrual credited the trade payable and the settlement is
looking for a claim payable. `web-settlement` already forbids this in so many words and no code on
either side performs the exclusion.

**A claim is a liability no report in the system can see.** `open-payables` excludes it,
`payables-ageing` inherits that exclusion, and `fx-revaluation` excludes it too. A company that owed
money to a person could not produce the total that IPSAS 1 / IAS 1 call *trade and other payables*.

**And the evidence rule is backwards.** A settlement — a cash payment with no bank trail — requires
a file. A payment recorded one at a time, with `batch_id` null and therefore no bank file behind it
either, requires nothing. The obligation to prove the money moved sits on the flow that can already
prove it.

None of this needs migrating around. There is no launched instance, no data, and nothing to keep
compatible. The right move is to remove the second mechanism, not to make it consistent with the
first.

## What Changes

**One payment record, whoever is paid.** A claim is settled by recording a `payment` against its
document, the same act, endpoint, permission and ledger path a purchase uses. `payment` gains the
three things `document_settlement` carried and it lacked: the **method** the money moved by, a
**reference**, and a **note**.

**One queue.** Ready-to-Pay is derived from what the ledger says is owed — a document with an
accrued payable and no payment — rather than from `post_action`. A document therefore appears in
exactly one queue because there is exactly one queue, not because two queues were made disjoint.

**One payables subledger.** Open payables and the ageing cover every payable the ledger raises. Each
row states the kind — trade or other — and who is owed, so the total can be composed rather than
merely summed. A claim is due the day its obligation was raised: terms are negotiated with a
supplier, and nobody negotiated on behalf of a person whose compensation was approved.

**Evidence follows the trail, not the document type.** A payment that rode a bank file is evidenced
by that file. A payment recorded by hand — cash, or a transfer typed into a banking app — has nothing
behind it and requires a slip. This both removes a burden the settlement flow carried unnecessarily
and closes the hole the payment flow left open.

**Withholding becomes available to every payee.** A payment to an individual for services is subject
to withholding in the jurisdictions this system targets; the settlement path had no way to express
it. Converging gives it the same `wht_tax_code` and certificate every payment has.

**The seed exercises the path.** `CLAIM_PAYABLE` is mapped, and a claim document type is seeded, so
the flow that pays a person is reachable on a fresh install instead of being specified and unbuilt.

**What is deleted.** `document_settlement`, `SettlementService`, `postSettlementClearing`, the
`CLAIM_SETTLEMENT` posting source, the settlements API, store, screen and route, and the
`web-settlement` capability. This change removes more than it adds.

## Who this answers

| party | what they could not do | after |
| --- | --- | --- |
| finance officer | see everything owed in one place; know which queue a document is in | one queue, one list, no configuration knowledge required |
| accountant | tie the payables report to the balance sheet | the report covers every payable account the ledger raises |
| management | state total payables and how much is late | one total, composed by kind, aged from one rule |
| auditor | find evidence for a hand-recorded payment | evidence is required exactly where no bank file exists |
| person owed a claim | be visible as a creditor at all | listed, aged from the day of approval |
| payee paid for services | have tax withheld correctly | the same WHT code and certificate a vendor payment gets |

## What This Change Does NOT Do

- **Does not unify vendors and people into one business-partner record.** `vendor` is group-level
  master data and `employee` is company-scoped; reconciling those is its own change, and paying a
  person does not require it — the document already names who is owed.
- **Does not put claims on a payment batch.** A bank file needs a destination account, and
  `vendor_bank_account` must belong to the document's own vendor. A claim paid in cash or by hand
  needs none, which is every claim this system can raise today. Batching them waits for a payee bank
  account that is not a vendor's.
- **Does not bring claims into FX revaluation.** A claim has no locked rate and no foreign-currency
  amount anywhere, so there is nothing to retranslate. That exclusion is a fact about the data, not
  a gap like the others.
- **Does not change how an obligation is raised.** Accrual at approval, the budget cut, the approval
  route, the document types and their flags all stay exactly as they are. Only what happens after
  the obligation exists converges.
