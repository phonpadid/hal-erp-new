## Context

The generic document engine already models a PO as a `document` typed PO created from a PR via
`ref_document_id` (the manual `DocumentService.createFrom` + `REF_CHAIN` config), reserves/settles
budget through the append-only `budget_txn` ledger, and runs post-actions atomically with the
terminal approval transition (`PostActionService.run`). What is missing is everything *after*
approval for procurement: `CREATE_PO` is an explicit no-op, `document_line.received_qty` /
`line_status` are initialized but never updated, no code compares ordered/received/invoiced, and a
settled disbursement produces no payable signal.

Constraints: no new tables (the user chose a lightweight handoff); `budget_txn` stays append-only;
every write is company-scoped and permission-gated; money stays decimal/string. The disbursement
that pays for a PO is itself a `document` whose type carries `post_action = CUT_BUDGET` and which
references the PO via `ref_document_id`; its lines carry the invoiced quantities/amounts (the
"invoice" leg of 3-way matching). Whether the PR or the disbursement carries `CUT_BUDGET` is seed
configuration, not code.

## Goals / Non-Goals

**Goals:**
- `CREATE_PO` auto-creates a DRAFT PO from the approved predecessor, reusing `createFrom`.
- A `DOC_RECEIVE` receive action accumulates `received_qty` and advances `line_status`, rejecting
  over-receipt.
- A 3-way matching service gates a disbursement (`CUT_BUDGET` doc referencing a PO) at submit:
  invoiced ≤ received ≤ ordered, amounts within tolerance.
- On settle, emit `payment.ready` and expose a derived ready-to-pay queue for accounting to pull.

**Non-Goals:**
- No payments/AP module, no invoice/payment tables, no GL posting, no second ledger.
- No change to budget balance math, FX locking, or the reserve→actual→release semantics.
- No goods-receipt *document* type — receipts accumulate on the PO's own lines (the schema intent
  of `received_qty` = cumulative). A separate GR document is out of scope.

## Decisions

**1. CREATE_PO via reverse REF_CHAIN.** `PostActionService` resolves the successor type by reverse
lookup over `REF_CHAIN` (find the successor code whose predecessor set includes the approved doc's
type code; require exactly one) and calls `DocumentService.createFrom(predecessorId, poTypeId)`,
leaving the PO `DRAFT`. Chosen over a new `document_type.creates_type` column (no new columns) and
over auto-submitting (the buyer must set vendor/prices first). If no/multiple successors resolve,
the post-action is a no-op (logged) rather than failing the approval.

**2. Receiving updates the PO line cumulatively.** A receive is an action on the PO document, not a
new ledger or document: `POST /documents/:id/receipts` with `{ lines: [{ lineId, qty }] }` runs in
one `em.transactional()`, adds to `received_qty`, and sets `line_status` (`received_qty == 0` → OPEN,
`0 < received_qty < qty` → PARTIAL, `>= qty` → RECEIVED; CLOSED is a manual short-close). Over-receipt
(`received_qty + qty > line.qty`) is rejected unless a future over-receipt tolerance is configured.
`received_qty` is a running total the schema calls "ยอดรับของสะสม", so an UPDATE (not an append) is
correct here; receipts are not a financial ledger.

**3. 3-way matching gates the disbursement, not a new entity.** When a document whose type
`post_action = CUT_BUDGET` and which has `ref_document_id` → a PO is submitted, a `MatchingService`
loads the PO lines and asserts, per matched line (by `line_no`/item): invoiced qty ≤ `received_qty`
and invoiced amount ≤ ordered amount × (1 + tolerance). Failure blocks submit with a clear reason.
This makes the disbursement's lines the invoice leg, so 3-way matching needs no invoice table.
A read endpoint returns the per-line match result for the UI panel.

**5. Disbursement settles the reserving ancestor's reservation.** Budget reservations are keyed by
`document_id` (`reserve`/`settle`/`outstandingReserved` operate on the reserving document). In the
chosen chain the PR reserves (on submit) and a separate disbursement settles, so `cutBudget` SHALL,
per budgeted line, resolve the document that holds the outstanding `RESERVE` for that budget by
walking `ref_document_id` back from the disbursement (disbursement → PO → PR) and call
`settle(reservingDocId, budgetId, invoicedBaseAmount)` so the ACTUAL/RELEASE rows stay consistent
with that reservation. When the document itself holds the reservation (the existing single-document
case, e.g. a budget adjustment), it settles its own — backward compatible. Seed flags:
PR `requires_budget=true` + `post_action=CREATE_PO`; PO `requires_budget=false`; disbursement
`requires_budget=false` + `post_action=CUT_BUDGET` (it does not re-reserve). Rejecting the
disbursement releases only its own (zero) holds, so the PR's reservation stands until a disbursement
settles or the PR is cancelled.

**4. Payment handoff is derived + event, no table.** `cutBudget` settle additionally emits
`payment.ready` (documentId, vendorId, base actual amount, GL accounts) via the existing
EventEmitter. `GET /payments/handoffs` (`PAYMENT_VIEW`) derives the ready-to-pay queue from
`COMPLETED` documents whose type `post_action = CUT_BUDGET`, joined to their ACTUAL `budget_txn`
rows and vendor — no stored status. "Exported" tracking, if ever needed, is a follow-up.

## Risks / Trade-offs

- [Concurrent receipts on one PO line racing `received_qty`] → Update under
  `LockMode.PESSIMISTIC_WRITE` on the line row inside `em.transactional()`; add a concurrency test
  that two partial receipts sum correctly without lost updates.
- [Matching tolerance / rounding on money] → Compare with `Money` (decimal/string), never float;
  make tolerance a small configurable percent defaulting to 0 (exact), documented per line.
- [Reverse REF_CHAIN ambiguity if a PR maps to multiple successors] → Require exactly one successor
  type; otherwise no-op + log, so approval is never blocked by procurement config.
- [Settlement timing vs matching] → Matching is enforced at the disbursement's submit, before its
  `CUT_BUDGET` settle on approval, so payment never precedes receipt. The reserve→actual ledger flow
  is unchanged; only the gate is added. Sequence note: receive (UPDATE received_qty, locked line) is a
  non-ledger write; settle still writes only ACTUAL + RELEASE `budget_txn` rows in one transaction.

## Migration Plan

No schema migration. Seed a `PO` document type (and a disbursement type carrying `CUT_BUDGET`
referencing the PO) and a `PR → PO` mapping so the chain is exercisable; seeds are data, not code.
New permission codes `DOC_RECEIVE` / `PAYMENT_VIEW` are added to the permission master + role grants.
Rollback is code-only; `received_qty` already existed and the queue is derived.

## Open Questions

- Over-receipt policy: hard-reject (default) vs a per-type tolerance — confirm before building step 2.
- Whether the PR or the disbursement document should carry `CUT_BUDGET` in the seeded chain (affects
  when reserve converts to actual); default: PR reserves, the disbursement settles.
