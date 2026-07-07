## Why

The post-action engine (build-order step 8) settles budget on approval and runs budget
transfer/adjust, but the **procurement chain after approval is stubbed**: `CREATE_PO` is a
no-op, there is no goods-receipt path (the `document_line.received_qty` / `line_status`
columns are never written), there is no 3-way matching to stop paying for goods not received,
and a settled `CUT_BUDGET` document goes nowhere — nothing hands the payable to accounting.
A buyer today cannot turn an approved PR into a received, matched, payable purchase order.

## What Changes

- **Auto-create the PO on PR approval.** The `CREATE_PO` post-action SHALL create a DRAFT
  successor PO from the approved predecessor (reusing `createFrom` + the `REF_CHAIN` pairing,
  resolved in reverse), instead of doing nothing. The buyer completes vendor/prices and submits.
- **Goods receipt / partial receive.** A new company-scoped, `DOC_RECEIVE`-gated action SHALL
  record received quantities against a PO's lines, accumulating `document_line.received_qty` and
  advancing `line_status` (OPEN → PARTIAL → RECEIVED), rejecting over-receipt beyond ordered qty.
- **3-way matching.** Before a disbursement (a `CUT_BUDGET` document referencing the PO) may be
  submitted/approved, the system SHALL match ordered (PO) vs received (`received_qty`) vs invoiced
  (the disbursement's lines) within tolerance, and block payment for quantities/amounts not received.
- **Payment handoff (lightweight).** On `CUT_BUDGET` settle, the system SHALL emit a `payment.ready`
  event and expose a read-only **ready-to-pay** queue (document, vendor, base actual amount, GL) for
  an external accounting system to pull — **no new payment/AP tables, no second ledger**.
- **Web UI.** A receive screen (enter received qty per PO line, show line status), a 3-way matching
  panel (PO vs received vs invoice), and a ready-to-pay list.

## Capabilities

### New Capabilities
- `procurement-receiving`: goods receipt / partial receive against PO lines and the 3-way
  matching gate (ordered vs received vs invoiced) before disbursement.
- `payment-handoff`: the ready-to-pay queue and `payment.ready` signal emitted when a budget
  disbursement settles, for external accounting to consume.
- `web-procurement`: the receive screen and 3-way matching panel.
- `web-payments`: the ready-to-pay list.

### Modified Capabilities
- `approval-workflow`: the `CREATE_PO` post-action SHALL auto-create the DRAFT PO (was a no-op),
  and `CUT_BUDGET` settlement SHALL additionally signal payment-ready.

## Impact

- **Backend:** `approval` module — `post-action.service.ts` (CREATE_PO, payment-ready signal); a new
  receiving service/controller on the `document` module (received_qty / line_status updates under a
  transaction); a 3-way matching service gating `document-submit`; a small `payment-handoff` read
  service/controller + event listener. New permission codes `DOC_RECEIVE`, `PAYMENT_VIEW`.
- **Frontend:** `front-end` — a receive view + line-status display, a matching panel on the
  disbursement document, a ready-to-pay list view, API clients + Pinia stores, shared Zod for the
  receive DTO.
- **Data model:** no new tables. Uses `document_line.received_qty` / `line_status`, `ref_document_id`,
  `vendor_id`, `gl_account`, and existing `budget_txn` ACTUAL rows; the ready-to-pay queue is derived
  from settled `CUT_BUDGET` documents.
- **Invariants:** append-only `budget_txn` unchanged (settle still writes ACTUAL/RELEASE only);
  company isolation on receipts and the queue; locked FX preserved; permission-code guards on every
  endpoint; matching enforced server-side (the UI mirror is advisory).
