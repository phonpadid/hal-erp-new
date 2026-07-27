## Why

A damaged-parcel claim consumes this company's budget and is paid from this company's bank account, but nothing in this system will ever record it as an expense. `GlPostingService` posts a journal entry when a **disbursement settles**, off `payment.settled` — and a claim produces no payment: the payee is a customer, not a vendor, so the type carries `requires_payee = false` and the money leaves through finance's bank app rather than a payment batch.

The result would be two books that disagree. The budget report shows the year's claims; the profit-and-loss shows nothing. An ERP that owns the budget but not the expense is answering the same question two ways.

There is also an accounting reason to post earlier than payment regardless. Approving a claim is the moment the obligation arises and its amount is fixed — the customer is owed, whether the transfer happens today or in three weeks. Recognition belongs at approval; payment only settles the liability it created. The system already models the same shape for goods: `GRNI` exists, as its own comment says, because *"receipt has no counter-account and the entry cannot balance"* — a liability standing between an obligation incurred and money paid. A claim needs the same counter-account.

## What Changes

- A new system account role, `CLAIM_PAYABLE`, resolved per company through the existing `account_role` mechanism — the liability that stands between an approved claim and the money leaving.
- A new opt-in flag on `document_type`. A type that carries it posts, on full approval, a balanced entry: **debit the expense accounts its budget cuts name, credit the payable**. Types without the flag behave exactly as they do today.
- The posting runs post-commit off the `approval.outcome` event the approval engine already emits, alongside the two listeners that consume it today. **No change to the approval engine, the routing service, or the post-action service.**
- The entry is idempotent per source, keyed the way every other posting in this module is keyed, so a retried event cannot double-post.

## Capabilities

### Modified Capabilities

- `gl-journal`: a new requirement that a configured document type posts an expense-and-liability entry at full approval, and a modification to the system-account-roles requirement to admit `CLAIM_PAYABLE`.
- `document-engine`: a new requirement that a document type declares whether its expense is recognised at approval.

### New Capabilities

None.

## Impact

- `erp_approval_system.dbml` — one flag on `document_type`; `account_role_type` gains a value.
- `back/src/common/enums/index.ts` — `AccountRoleType.CLAIM_PAYABLE`.
- `back/src/modules/document/document.entities.ts` — the flag.
- `back/src/migrations/` — one additive migration: a boolean defaulting to false, so every existing type keeps today's behaviour.
- `back/src/modules/gl/` — a posting method and a listener subscription.
- No change to `budget_txn`, `quota_usage`, the approval chain, permission codes, or company scoping. The invariants hold: this writes `journal_entry` only, never a ledger row it did not already write, and `GlPostingService` is already documented as never writing `budget_txn`.

**A correction to how this was described earlier in planning.** Full approval does not leave a document at `APPROVED`. `ApprovalRoutingService` sets `APPROVED`, runs the post-action inside the same transaction, then sets `COMPLETED` — so `COMPLETED` is the persisted end state of an approved document, and `APPROVED` is transient. This change is unaffected (it hooks the outcome event, which carries `status: 'COMPLETED'`), but the follow-up that records payment cannot use `COMPLETED` to mean "paid" — that status is already taken by "fully approved".
