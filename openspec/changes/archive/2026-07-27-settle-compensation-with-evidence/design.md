## Context

The accrual change left the ledger with one half of a story:

```
   approval  ──▶  Dr claim expense      4,500
                      Cr CLAIM_PAYABLE      4,500
                             │
                             └── and nothing ever debits it back
```

Three facts shape how the other half gets written.

**`COMPLETED` is already taken.** `ApprovalRoutingService` sets `APPROVED`, runs the post-action, then sets `COMPLETED` in the same transaction — so `COMPLETED` is the terminal status of a *fully approved* document. It cannot also mean "paid".

**A `payment` row is not available either.** `payment` is keyed one-per-document and drives `payment.settled`, which is what `postForPayment` listens to. Writing one to represent a bank-app transfer would post a second entry debiting the same expense accounts, and the expense would land in the P&L twice.

**Evidence already has a home.** `document_attachment` hangs off the document with an uploader and a timestamp, and the claim's damage photos and QR already arrive through it. `payment_attachment` does not fit: it requires a `payment`, and its own spec is explicit that slips are *"evidence, not settlement — they never touch the budget or a quota"*. Making an upload change state would rewrite that contract for every document type that uploads one.

So the settlement needs a record of its own.

## Goals / Non-Goals

**Goals:**
- The payable raised at approval is cleared when the money actually leaves.
- The system can answer "which approved claims are still unpaid" without a spreadsheet.
- A settlement cannot be recorded twice, and cannot be recorded by a machine.
- Nothing about the evidence's *kind* is baked in, so settlement in goods needs no second endpoint.

**Non-Goals:**
- Compensation in goods. `settlement_type` is recorded and validated; only `CASH` is accepted. The stock movement, its costing, and the difference between the goods' cost and the accrued amount are a later change.
- Clearing payables accrued before this ships. Those have no settlement record and are a manual journal.
- Replacing the payment-batch flow for types that use it. A type that requires a payee still settles through `payment` and `postForPayment`, untouched.
- Partial settlement. One claim, one settlement, for the accrued amount. Anything else is a correction, and corrections in this system are new rows rather than edits.

## Decisions

**A `document_settlement` row, not columns on `document`.**
It records an action a person took, with an actor and a timestamp — the shape `approval_log` and `vendor_bank_account_log` already use for accountable actions. It also makes "settled once" a unique constraint rather than a nullability convention, and keeps four columns off `document` that would be null for every type but one.

*Alternative — `settled_at` / `settlement_type` / `reference` / `settled_by` on `document`.* Rejected on those two grounds. It reads simpler until the first question about who recorded what, and it makes the once-only rule something the service has to remember.

*Alternative — infer "paid" from the existence of the clearing journal entry.* Rejected: it makes the ledger the source of truth for an operational state, so a company that has not mapped its accounts could never mark anything paid, and the finance queue would silently include everything.

**One endpoint that does all of it, in one transaction.**
The attachment, the settlement row, and the journal entry are written together. A settlement recorded without its evidence is a claim nobody can audit; evidence uploaded without a settlement is a file nobody looks at. Splitting them across two calls creates a window where the system holds one and not the other, and the window is on the money side.

*Alternative — reuse `POST /documents/:id/attachments/upload` with a flag.* Rejected: it overloads an endpoint every document type uses, and the flag would be the only thing between "attach a photo" and "declare money spent".

**`ApiKeyDenyGuard` on the endpoint, and `PAYMENT_MANAGE` as the permission.**
The endpoint sits on the document controller, which accepts API keys — so without the guard the claim system's own bot could declare a payment nobody made. The prohibition belongs on the channel, exactly as it does for approval: no grant should be able to turn it on. `PAYMENT_MANAGE` rather than a document permission because the act is a finance act; the person who raises a claim is not the person who says the money left.

**The credit side resolved by role, keyed on the settlement type.**
`CASH` credits `CASH_CLEARING`, which already exists and is what the payment posting credits. A later goods settlement credits `INVENTORY`, which also already exists. Writing the lookup as type → role now is what makes that a mapping rather than a rewrite, and it costs nothing today.

**Only `CASH` is accepted, and anything else is refused explicitly.**
A `400` naming the unsupported type is a better answer than treating an unknown value as cash. The column and the validation exist from the first row so the data can be told apart later, and so the claim system can start sending the field immediately rather than after a cross-team change.

**Idempotent on `('CLAIM_SETTLEMENT', documentId)`.**
A third source type alongside `PAYMENT` and `APPROVAL_ACCRUAL`. One document can now carry two entries — the accrual and its clearing — and `journal_entry` is unique per `(company, source_type, source_id)`, so they must not share a key.

**The posting is inside the transaction here, unlike the accrual.**
The accrual runs post-commit because a chart-of-accounts problem must not roll back an approval that approvers already granted. This is the opposite case: nothing has been granted yet, the whole action is one operator saying "the money left, here is the slip", and if the ledger cannot record that then the settlement should not be recorded either. A half-recorded settlement is worse than a rejected one, because the operator would believe it was done.

**No lock and no ledger write.** This writes `document_settlement`, `document_attachment`, `journal_entry`, `journal_line`. It writes no `budget_txn` — the budget settled to `ACTUAL` at approval and paying it out settles nothing further — and no `quota_usage`.

## Risks / Trade-offs

**A settlement recorded for a document that never accrued would debit a payable it never raised** → the endpoint refuses a document whose type does not accrue on approval, and refuses one with no accrual entry; both are spec scenarios rather than comments.

**An operator could record a settlement before the money actually left** → the system cannot know; what it can do is make the claim accountable, which is why the actor, the timestamp, the reference and the evidence are all required and immutable once written. That is the same bar the approval chain sets.

**Approved-but-unpaid is now visible, and the list may be long on day one** → every claim approved before this ships appears unsettled, correctly, because it has no settlement record. Finance needs to know that the first view of the queue includes history, not just today's work.

**Requiring evidence could block a legitimate settlement** where the bank app produces no slip → accepted deliberately: the requirement is one file, not a slip, and a screenshot satisfies it. A settlement no one can evidence is exactly the one worth blocking.

**The clearing amount is the accrued amount, not what the bank actually moved** → for a domestic transfer in the company's own currency these are the same. They stop being the same the moment a claim is paid in another currency or partially, and neither is in scope; the spec says one settlement for the accrued amount so a future partial payment breaks a test rather than the payable.
