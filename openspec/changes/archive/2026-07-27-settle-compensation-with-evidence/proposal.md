## Why

A claim that accrues at approval leaves a liability behind: `Dr claim expense / Cr CLAIM_PAYABLE`. Nothing in the system ever clears it. Finance transfers the money through the bank's own app — the payee is a customer, not a vendor, so there is no payment batch and no `payment.settled` to post the other half — and the ledger keeps a payable that grows by every claim ever approved.

The gap is not only accounting. Once a claim is approved the system cannot tell "approved, waiting to be paid" from "paid last Tuesday". Both read `COMPLETED`. Finance ends up keeping the real list in a spreadsheet beside the ERP, which is where a claim gets paid twice or not at all.

Both problems have one answer: record the payment where it happens, with the evidence that proves it happened.

## What Changes

- A new `document_settlement` record — one per document — naming how the compensation was settled, when, by whom, and under what reference. Its presence is what distinguishes a paid claim from an approved one; its absence is the finance queue.
- A new endpoint that records it: it takes the evidence file and the settlement details in one call, writes the attachment, writes the settlement, and posts `Dr CLAIM_PAYABLE / Cr <the account the settlement type credits>`. One action, one transaction, one thing that either happened or did not.
- Evidence is required, but its *kind* is not prescribed: at least one file. Today that is a transfer slip; a later settlement in goods will attach a delivery note through the same door.
- `settlement_type` is recorded from the first row, with only `CASH` accepted for now. Any other value is refused with "not supported yet" rather than silently treated as cash.
- The credit account is resolved by role, so admitting a second settlement type later is a mapping, not a rewrite.

## Capabilities

### Modified Capabilities

- `gl-journal`: a new requirement that recording a settlement clears the payable the accrual raised, idempotently and by role.
- `document-engine`: a new requirement that a document accrued at approval is settled exactly once, with evidence, by a finance actor — and that an API key may never do it.

### New Capabilities

None.

## Impact

- `erp_approval_system.dbml` — one new table, `document_settlement`, unique per document.
- `back/src/migrations/` — one additive migration creating it. No existing row or column changes.
- `back/src/modules/document/` — the entity, a service that records the settlement, one endpoint on the document controller.
- `back/src/modules/gl/` — a posting method that clears the payable.
- No change to `budget_txn` or `quota_usage`: the budget settled to `ACTUAL` when the document was approved, and paying it out settles nothing further. No change to the approval chain, to `postForPayment`, or to the accrual posting.
- **The endpoint carries `ApiKeyDenyGuard`.** It lives on the document controller, which accepts API keys, and it is the door money leaves by: an external system must never be able to declare a payment it did not make. This is the same bar the approval endpoints already hold.

**A note on what this does not solve.** Settlements recorded from today forward clear their own payable. Any claim approved before this ships has a payable with no settlement record, and clearing those is a manual journal by finance — `docs/claim-payable-note.md` already tells them to expect it.
