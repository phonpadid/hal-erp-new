## 1. Canonical model first

- [x] 1.1 Add `Table document_settlement` to `erp_approval_system.dbml`: `id`, `company_id`,
  `document_id` (unique — one settlement per document), `settlement_type`, `settled_at`,
  `reference`, `settled_by`, `note`, `created_at`. Note on the table that its presence is what
  distinguishes a paid document from an approved one, and that `COMPLETED` cannot carry that
  meaning because it already means "fully approved".
- [x] 1.2 Carry `company_id` on the row and say why in the note — the query finance actually runs
  is "what is unsettled in this company", and invariant 1 filters by company first. Mirror
  `payment_attachment`, which carries it for the same reason.

## 2. Entity and migration

- [x] 2.1 Add the `DocumentSettlement` entity with a unique constraint on the document, and a
  comment stating that it is written once and never edited.
- [x] 2.2 Generate the migration. Confirm it only creates a table — no existing column or row
  changes.
- [x] 2.3 Run `migration:up` on a scratch database and confirm the unique constraint rejects a
  second row for the same document.

## 3. Record the settlement

- [x] 3.1 Add a service method that, in ONE transaction: validates the document is of a type with
  `accruesOnApproval`, is fully approved, has an accrual entry, and has no settlement yet; stores
  the uploaded file as a `document_attachment`; writes the `document_settlement`; and posts the
  clearing entry. Any failure rolls back all four.
- [x] 3.2 Accept `CASH` only. Any other `settlementType` is a `400` naming it as not yet supported
  — never silently treated as cash.
- [x] 3.3 Require at least one evidence file, checked before anything is written.
- [x] 3.4 Add the endpoint to the document controller with the file interceptor, `PAYMENT_MANAGE`,
  and **`ApiKeyDenyGuard`**. Name it for the action (`settle`), not for the evidence — a later
  settlement in goods attaches a delivery note through the same door.
- [x] 3.5 Add a way to ask for accrued-but-unsettled documents, so the finance queue is a query
  rather than a spreadsheet.

## 4. Clear the payable

- [x] 4.1 Add a posting method to `GlPostingService` that debits `CLAIM_PAYABLE` for the accrued
  amount and credits the role the settlement type maps to (`CASH` → `CASH_CLEARING`), guarded on
  `findOne(JournalEntry, { company, sourceType: 'CLAIM_SETTLEMENT', sourceId: documentId })`.
- [x] 4.2 Take the amount from the accrual entry's own credit line rather than recomputing it from
  `budget_txn`, so the two halves can never disagree.
- [x] 4.3 Write the type → role mapping as a lookup, not an `if`. It is the seam the goods
  settlement will use.
- [x] 4.4 Confirm the accrual posting, `postForPayment`, and the approval engine are untouched.

## 5. Prove it

- [x] 5.1 DB-backed spec: approve an accruing document, record a `CASH` settlement, and assert the
  clearing entry debits `CLAIM_PAYABLE` and credits `CASH_CLEARING` for the accrued amount, and
  that the payable nets to zero across the two entries.
- [x] 5.2 Spec: the settlement row carries the actor, reference and timestamp given, and the file
  is stored as an attachment of the document.
- [x] 5.3 Spec: a second settlement for the same document is rejected and the first is unchanged.
- [x] 5.4 Spec: recording with no file writes nothing at all — no settlement, no attachment, no
  entry.
- [x] 5.5 Spec: with `CASH_CLEARING` unmapped, the whole request fails and nothing exists
  afterwards. This is the case that proves the transaction boundary, so assert all four tables.
- [x] 5.6 Spec: a document of a non-accruing type is rejected.
- [x] 5.7 Spec: a document with no accrual entry is rejected.
- [x] 5.8 Spec: a settlement type other than `CASH` is rejected by name.
- [x] 5.9 Spec: the unsettled query returns exactly the accrued documents without a settlement.
- [x] 5.10 Spec: no `budget_txn` row is written by any of it.
- [x] 5.11 Spec: the endpoint is denied to an API-key request whose bound user holds
  `PAYMENT_MANAGE` — the guard, not the grant, is what refuses it.

## 6. Verify

- [x] 6.1 Run the full `pnpm --filter back test`; watch the accrual and payment posting specs in
  particular.
- [x] 6.2 Run `pnpm --filter back boot:check`.
- [x] 6.3 Re-read both delta specs against the implementation, then archive through
  `/opsx:archive`.

## 7. Say what it does not fix

- [x] 7.1 Update `docs/claim-payable-note.md`: settlements recorded from now on clear their own
  payable, but every claim approved before this shipped still needs a manual journal, and the first
  view of the unsettled queue will include that history rather than only today's work.
