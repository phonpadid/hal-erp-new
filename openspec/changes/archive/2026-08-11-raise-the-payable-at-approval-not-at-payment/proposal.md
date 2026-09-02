## Why

The mainstream purchase in this system is recognised on a **cash basis**, and has no accounts
payable at all.

```
service or expense purchase, PROC → PO → DISB

  goods or service received   nothing posted
  DISB fully approved         nothing posted        ← the obligation is now certain
  payment settled             Dr EXPENSE / Cr CASH  ← expense recognised here
```

Expense lands in the month the money leaves, not the month the obligation arose. December's costs
paid in January appear in January, so monthly statements are not usable; and between approval and
payment the company owes a vendor an amount that appears nowhere in its books. There is no `AP`
account, no vendor balance, and no answer to *"who do we owe, how much, and when is it due"* — the
first question anyone asks of a procurement system.

The budget and the ledger also cut at different moments. Budget settles to ACTUAL when the DISB is
approved (`PostActionService.cutBudget`); the GL posts when the payment settles. The two can never
be reconciled to each other, because they are recording different events.

**The pattern already exists here, twice.** `GRNI` bridges receipt to payment for stock, and
`CLAIM_PAYABLE` bridges approval to payment for compensation — each raising a liability when the
obligation arises and clearing it when the money leaves. Both post correctly today. The vendor
purchase, which is the volume, is the one that never got a bridge:

```
GRNI              receipt  ──[liability]── payment      ✓ stock only
CLAIM_PAYABLE     approval ──[liability]── settlement   ✓ non-vendor claims only
ACCOUNTS_PAYABLE  approval ──[     ?    ]── payment     ✗ everything else
```

The system even has the flag: `document_type.accrues_on_approval`. It cannot be used for a purchase
because `DocumentTypeService` rejects it alongside `requires_payee`, on the grounds that *"ทั้งสอง
ทางเดบิตบัญชีค่าใช้จ่ายชุดเดียวกัน จะรับรู้ซ้ำสองรอบ"* — both paths debit the same expense accounts,
so recognition would happen twice. That is true **while the payment path always debits expense**. It
stops being true the moment the payment path clears a payable when one was raised, which is the
whole of this change.

## What Changes

- A new `ACCOUNTS_PAYABLE` `account_role`.
- **A document with a vendor accrues to `ACCOUNTS_PAYABLE`; one without accrues to
  `CLAIM_PAYABLE`.** The role is derived from `document.vendor_id`, not configured: "an approved
  obligation to a vendor is a trade payable" is something the data already answers, and a second
  flag would only add a way to set it wrongly.
- **The accrual follows the reference chain.** `postAccrualForApproval` reads the document's *own*
  `budget_txn` ACTUAL rows, which is correct for a claim and wrong for a purchase: on a PROC → PO →
  DISB chain the ACTUAL rows are written under the reserving ancestor, so a DISB would find none and
  accrue nothing — silently reverting to expense-at-payment. The vendor path uses the same walk
  `settlementActuals` makes; the claim path keeps own-rows.
- **Input VAT moves from payment to accrual.** The tax point of input VAT is the invoice, not the
  cash. Debiting `VAT_INPUT` at payment reports a December invoice paid in January in January's VAT
  summary, which is the wrong filing period. The payable is raised gross — `base_locked`, which
  already includes tax — because that is what is owed.
- **The stock split moves with it.** A stock-tracked line clears `GRNI` at accrual rather than at
  payment: the goods were capitalized at receipt and the invoice is what turns that into a vendor
  debt.
- **The payment posting branches once.** If an accrual exists for the document, it debits the
  payable that accrual credited and posts FX and WHT around it; if not, it does exactly what it does
  today. That single `if` is what makes this incremental — types opt in one at a time, and every
  document approved before this ships still settles the old way.
- **`accrues_on_approval` may be set with `requires_payee`.** The rejection in
  `DocumentTypeService` is removed, because its premise no longer holds.
- **Open payables are readable**: a `GL_VIEW`-gated, company-scoped list of documents accrued and
  not yet paid, with vendor, amount, invoice date and due date from `vendor.payment_term_days`.
  Derived — `payment.document_id` is unique, so there are no partial payments and every open item is
  computable from the journal. No new table.

The entries, for a purchase of 100,000 + 7% VAT, paid with 3% WHT and a 2,000 FX loss:

| | Dr | Cr |
|---|---|---|
| DISB approved 🆕 | EXPENSE 100,000 · VAT_INPUT 7,000 | **AP 107,000** |
| payment settled ♻️ | **AP 107,000** · FX_LOSS 2,000 | WHT_PAYABLE 3,000 · CASH_CLEARING 106,000 |

`107,000 + 2,000 = 3,000 + 106,000` — and the cash credit is `base_actual − wht`, the formula
already in the code. AP clears at the rate it was raised at, so the whole FX difference lands in FX
where it belongs, which is cleaner than what the single-entry version does today.

Deliberately **out of scope**:

- **Period-end FX revaluation of open payables.** IAS 21 requires it, and it needs the original
  currency of each open item, which the journal does not carry. That is the real trigger for an
  `ap_open_item` subledger, and it belongs with the accounting periods that give it a date to
  revalue at. Stated plainly: **until then, foreign-currency payables are not revalued.**
- **Partial payments, credit notes, and vendor debit notes.** `payment.document_id` is unique — one
  document is paid once — so none of them is expressible today, and each changes what an open item
  is.
- **Backfilling documents approved before this ships.** They have no accrual, so their payments
  settle the old way and their expense stays where it was recognised. Manufacturing accruals for
  them would restate closed months from a system that has no period close.
- **AP aging buckets and a screen.** The open-items read returns due dates; bucketing them and
  drawing them is a report, and it can be built on this without changing it.

## Capabilities

### New Capabilities

None. This is `gl-journal`'s posting engine and `document-engine`'s type configuration; inventing an
`accounts-payable` capability would split one liability across two specs and leave neither owning
the entries.

### Modified Capabilities

- `gl-journal`: `Posting on Approval for Types That Accrue` gains the vendor payable and the chain
  walk; `Posting on Payment Settlement` clears an existing payable instead of re-debiting expense;
  `Config-Driven System Account Roles` gains `ACCOUNTS_PAYABLE`; `Settling a Stock Purchase Clears
  GRNI` and the input-VAT debit move to the accrual; a new requirement makes open payables readable.
- `document-engine`: a type MAY both accrue at approval and require a payee.

## Impact

**Backend**

- `back/src/common/enums/index.ts` and `erp_approval_system.dbml` — `ACCOUNTS_PAYABLE` in
  `account_role_type`. No new table, no migration beyond the enum.
- `back/src/modules/gl/gl-posting.service.ts` — `postAccrualForApproval` splits into a vendor path
  (chain walk, VAT, stock split, `ACCOUNTS_PAYABLE`) and the existing claim path;
  `postForPayment` gains the accrual branch. `stockPortionByAccount` and its
  `chargedDocumentId` fallback move to the accrual unchanged — they were fixed in
  `clear-grni-when-the-chain-pays-for-stock`, so what moves is correct code.
- `back/src/modules/document/document-type.service.ts:99` — the mutual-exclusion rejection is
  removed, and its test with it.
- `back/src/modules/gl/journal.service.ts` / `journal.controller.ts` — the open-payables read.
- `back/src/seed/seed-data.ts` — `ACCOUNTS_PAYABLE` mapped for the seeded company, and
  `accrues_on_approval` set on `DISB`, which the seed already creates with
  `requiresVendor: true, requiresPayee: true, postAction: 'CUT_BUDGET'`.

**Invariants**

- Invariant 3 and 6 are untouched: the accrual writes no `budget_txn` and reads the ACTUAL rows the
  budget already wrote. FX still goes to accounting, not the budget.
- Invariant 7: the accrual is driven by `document_type.accrues_on_approval` and the payable by the
  document's own vendor — no branch on a type code.
- Invariant 1: `account_role` is per company, and the open-payables read is company-scoped.

**Risk**

The one way this goes badly wrong is double recognition: a type that accrues while the payment path
still debits expense would charge the same purchase to profit and loss twice, which is exactly what
the rejection being removed was guarding against. The branch in `postForPayment` is the whole guard,
and it must be tested from both sides — a document with an accrual and one without — before any type
is configured to accrue.

Second: a company that enables this without mapping `ACCOUNTS_PAYABLE` gets a logged, queryable
failed posting rather than a wrong entry, because the role resolver already refuses. The undelivered
read from `see-what-the-journal-failed-to-post` is what makes that visible instead of silent.
