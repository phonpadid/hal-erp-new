## 1. Ledger rule

- [x] 1.1 Add `BudgetLedgerService.budgetsHeldByAncestors(documentId, budgetIds, em)` — walk `document.ref_document_id` upward with a `seen` guard, return the budget ids whose outstanding reserve (`outstandingReserved`) on an ancestor is greater than zero
- [x] 1.2 Lock the candidate `budget` rows `FOR UPDATE` in ascending id order inside that method — the same order `reserveIn` uses, so the two cannot deadlock — before reading any outstanding amount
- [x] 1.3 No entity or migration work: the rule reads `document.ref_document_id` and `budget_txn` as they already exist in `erp_approval_system.dbml`

## 2. Submit path

- [x] 2.1 In `DocumentSubmitService.submit`, inside the existing `em.transactional(...)` that writes `budget_txn`, filter `reserveLines` by `budgetsHeldByAncestors` and reserve only the budgets no ancestor holds
- [x] 2.2 Keep the existing completeness guards unchanged (every positive-amount line must resolve a budget; a budget-controlled document must have at least one budgeted line) so skipping a hold never weakens coverage validation

## 3. Settlement and posting

- [x] 3.1 Leave `PostActionService.cutBudget` / `resolveReservingDocument` as they are — they already settle the chain's holder
- [x] 3.2 In `GlPostingService`, add `settlementActuals(tem, documentId)`: use the paid document's `budget_txn` ACTUAL rows, else walk `ref_document_id` to the nearest ancestor carrying ACTUAL rows
- [x] 3.3 In `DocumentService.createFrom`, populate `taxCode` and copy the predecessor line's `taxCodeId` onto the successor line

## 4. Tests

- [x] 4.1 `chain-reservation.spec.ts` (DB-backed): successor does not re-reserve a held budget; chain settles with nothing stranded; successor of an already-settled predecessor takes its own hold; a document with no predecessor reserves normally; create-from carries the line tax code through to the successor's totals
- [x] 4.2 `gl-posting.service.spec.ts`: a paid document with no ACTUAL of its own posts a balanced entry from its ancestor's ACTUAL rows
- [x] 4.3 Concurrency test: a submit that would skip the hold, racing the settlement of the ancestor that holds it, must not leave the chain with zero holds — assert the pessimistic lock serializes them (submit either skips and the settle waits, or reserves its own)
- [x] 4.4 Full backend suite green (`npx vitest run`), and each new test verified to fail against the pre-change code

## 5. Existing data

- [x] 5.1 Append a RELEASE `budget_txn` for each pre-change stranded reserve (a COMPLETED document whose outstanding reserve can no longer be settled), never editing or deleting ledger rows — invariant 2
- [x] 5.2 Re-run `GlPostingService.postForPayment` for documents paid before task 3.2 that have a `payment` row but no `journal_entry` (idempotent per source, so already-posted documents are a no-op)
- [x] 5.3 Both repairs run from `back/scripts/repair-chain-ledger.ts` — dry-run by default, `--apply` to write; the stranded-hold search only touches a COMPLETED document whose ref-chain descendant already recorded an ACTUAL on the same budget, so a live reservation is never released
