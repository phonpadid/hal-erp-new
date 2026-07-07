## 1. Backend — CREATE_PO post-action

- [x] 1.1 Add a reverse `REF_CHAIN` resolver (predecessor type code → single successor type code) and a helper to resolve the successor `DocumentType` in the document's company.
- [x] 1.2 Implement `CREATE_PO` in `post-action.service.ts`: resolve the successor type, call `DocumentService.createFrom(documentId, poTypeId)` to create a DRAFT PO; no-op + log when zero/multiple successors resolve.
- [x] 1.3 Unit test: an approved PR with `post_action=CREATE_PO` creates a DRAFT PO referencing it (vendor/lines copied); ambiguous/none resolves to a logged no-op without failing approval.

## 2. Backend — Goods receipt / partial receive

- [x] 2.1 Add `DOC_RECEIVE` to the document permission codes + permission master/role seed.
- [x] 2.2 Add a `ReceivingService` + endpoint `POST /documents/:id/receipts` (`DOC_RECEIVE`, company-scoped) taking `{ lines: [{ lineId, qty }] }`; in one `em.transactional()` lock each line (`PESSIMISTIC_WRITE`), add to `received_qty`, set `line_status` (OPEN/PARTIAL/RECEIVED), reject over-receipt.
- [x] 2.3 Expose received qty / line_status on the document detail read so the UI can show them.
- [x] 2.4 Unit tests: partial→full advances status; over-receipt rejected; **concurrency test** — two parallel receipts sum without lost updates.

## 3. Backend — 3-way matching

- [x] 3.1 Add a `MatchingService.match(disbursementId)` that loads the referenced PO and returns per-line ordered vs `received_qty` vs invoiced (qty + amount via `Money`, never float) with a pass/fail and tolerance (default exact).
- [x] 3.2 Gate `DocumentSubmitService.submit` for a `CUT_BUDGET` document that references a PO: run matching and block submit with a per-line reason on failure.
- [x] 3.3 Read endpoint `GET /documents/:id/matching` (`DOC_VIEW`) returning the per-line match result.
- [x] 3.4 In `cutBudget`, resolve the reserving ancestor per budgeted line (walk `ref_document_id` back to the document holding outstanding `RESERVE`) and settle that reservation; fall back to the document's own reservation when it holds one (backward compatible).
- [x] 3.5 Unit tests: invoicing more than received blocks submit; a fully-received, in-tolerance disbursement passes and settles the PR's reservation (ACTUAL on the PR, reservation cleared); match read returns per-line figures.

## 4. Backend — Payment handoff

- [x] 4.1 Emit `payment.ready` (documentId, vendorId, base actual amount, GL) from `cutBudget` settle; add a listener stub (logs/dispatch seam) — no new table.
- [x] 4.2 Add `PAYMENT_VIEW` permission + a `payment-handoff` read service/controller `GET /payments/handoffs` deriving the ready-to-pay queue from `COMPLETED` `CUT_BUDGET` documents joined to their ACTUAL `budget_txn` + vendor, company-scoped.
- [x] 4.3 Unit tests: settle emits `payment.ready`; the queue lists a settled document with vendor/amount/GL and excludes other companies'.

## 5. Seed / config

- [x] 5.1 Seed a `PO` document type and a disbursement type carrying `post_action=CUT_BUDGET`, the `PR → PO` and `PO → disbursement` reference pairings, and dept mappings so the chain is exercisable. Grant `DOC_RECEIVE` / `PAYMENT_VIEW` to appropriate roles.

## 6. Shared schema

- [x] 6.1 Add a shared Zod schema for the receive DTO (`{ lines: [{ lineId: uuid, qty: decimal-string }] }`), mirrored by the backend DTO; quantities are strings, never JS numbers.

## 7. Frontend — Procurement UI

- [x] 7.1 Receive view/action on a PO: editable received qty per line with ordered qty + `line_status`; calls `POST /documents/:id/receipts`; gated by `DOC_RECEIVE`; surfaces server rejections.
- [x] 7.2 3-way matching panel on a disbursement document: per-line ordered vs received vs invoiced with pass/fail, from `GET /documents/:id/matching`; surface the submit block.
- [x] 7.3 API clients + Pinia store wiring for receive + matching.

## 8. Frontend — Payments UI

- [x] 8.1 Ready-to-pay list view (`/payments`) from `GET /payments/handoffs`: document, vendor, base amount, GL, link to source; empty state; nav + view gated by `PAYMENT_VIEW`.
- [x] 8.2 API client + Pinia store for the ready-to-pay queue; i18n (en + la).

## 9. Verification

- [x] 9.1 Backend unit + concurrency tests green (`vitest`); frontend unit tests + build.
- [ ] 9.2 Manual smoke: approve a PR → PO auto-created → receive partially then fully → submit a disbursement (blocked when over-received, passes when matched) → appears in ready-to-pay.
