## Why

A document type flagged `records_past_events` (on HAL: `SPEND_HIST`, "ບັນທຶກລາຍຈ່າຍຍ້ອນຫຼັງ") records money that was **already paid**. The requester attaches the slips up front, and the type cuts budget through `post_action = CUT_BUDGET`. The ready-to-pay queue, though, lists every completed `CUT_BUDGET` document that has no payment record. So once a past-spend document is fully approved, finance is offered it as an amount still to pay, and can batch or record it, paying the same money a second time. On the 2026-10-13 export, `SPEND_HIST-HAL-2026-0001` (28,561,000) and `-0002` (42,000,000) meet that predicate.

## What Changes

- The "owed" predicate (`owedDocuments`) no longer lets the `CUT_BUDGET` clause speak for a type whose `records_past_events` is true. That money already moved, so the post-action no longer implies a debt.
- The accrual clause is unchanged. If a past-event type ever does credit a payable account at approval, the ledger still says it is owed and it is still listed.
- Because the queue, the batch builder, the slip-status column and the record-payment endpoint all share this one predicate, a past-spend document disappears from all of them together. Recording a payment against one is refused with the existing "not something the company owes" message.
- Budget behaviour is unchanged: RESERVE at submit, ACTUAL (dated by the stated money-moved day) plus RELEASE at final approval.

## Capabilities

### New Capabilities

### Modified Capabilities
- `payment-handoff`: Ready-to-Pay Queue. A document whose type records past events is not owed through its post-action.

## Impact

- `back/src/modules/payment-handoff/owed.ts`: one clause.
- Tests in `back/src/modules/payment-handoff/payment-handoff.spec.ts`.
- No migration and no frontend change. The slip column shows a dash for such documents, as it does for any non-payable.
