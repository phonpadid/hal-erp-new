## 1. Schema

- [x] 1.1 Add `Migration20260917000000.ts`: pre-check `SELECT ref_document_id, document_type_id, count(*) FROM document WHERE ref_document_id IS NOT NULL AND status NOT IN ('REJECTED','CANCELLED') GROUP BY 1,2 HAVING count(*) > 1` and throw with the offending `doc_no`s if any; then `CREATE UNIQUE INDEX document_live_successor_uq ON document (ref_document_id, document_type_id) WHERE ref_document_id IS NOT NULL AND status NOT IN ('REJECTED','CANCELLED')`; `down()` drops it
- [x] 1.2 Declare the partial index on the `Document` entity in `document.entities.ts` (`@Index` with `expression`) so the ORM snapshot matches; regenerate `.snapshot-hal_erp.json`
- [x] 1.3 Add the index to `erp_approval_system.dbml` `document.indexes` with a `// partial: WHERE ref_document_id IS NOT NULL AND status NOT IN (...)` note, mirroring the `source_id` partial index comment

## 2. Backend — document engine

- [x] 2.1 `document.service.ts` `assertPredecessor`: after the pairing check, find a live successor (`ref_document_id = refId`, `document_type_id = successorType.id`, `status NOT IN [REJECTED, CANCELLED]`) and throw `BadRequestException("<pred.docNo> already has <TYPE_CODE> <succ.docNo> (<status>)")`
- [x] 2.2 `createDraft`: wrap the flush so a `UniqueConstraintViolationException` whose constraint is `document_live_successor_uq` is rethrown as `ConflictException` with the same message shape (re-read the winning successor to name it); other unique violations unchanged
- [x] 2.3 `DocumentService.detail`: add `successors: { id, docNo, typeCode, status }[]` — live documents with `refDocument = id` in the active company, `documentType` populated; update the detail response type / DTO
- [x] 2.4 Unit tests `back/src/modules/document/one-live-successor.spec.ts`: second `PO` refused naming the first; second `DISB` from a completed `PO` refused; cancelled `PO` frees the slot; rejected `PO` frees the slot; a different successor type is not blocked; detail lists live successors and omits cancelled ones; no `budget_txn`/`quota_usage` written
- [x] 2.5 Concurrency test (real Postgres, same harness as `chain-reservation.spec.ts` / numbering tests): two concurrent `createFrom(PR, PO)` → exactly one `PO` row, the loser gets 409

## 3. Backend — successor outbox

- [x] 3.1 `successor-sweeper.service.ts` `fulfil`: before `createFrom`, look for a live successor of `row.successorType` on `row.sourceDocument`; found → mark `DONE`, log "already exists … obligation met", return true without incrementing `attempts`
- [x] 3.2 Test in `successor-outbox.spec.ts`: hand-raised `PO` → row `DONE`, `attempts` unchanged, one `PO`; sweeper losing the race → `PENDING` + `attempts` +1, next sweep `DONE`

## 4. Frontend

- [x] 4.1 `front-end/src/api/documents.ts`: add `successors` to the detail type (tolerate absent → `[]`)
- [x] 4.2 `DocumentDetailView.vue`: filter the create-successor type picker to pairings with no live successor; hide the action when all are taken; render each live successor as a `router-link` with `doc_no` + status tag
- [x] 4.3 On create-from failure (400/409) show the server message and re-read the detail so the winning successor appears
- [x] 4.4 i18n en/la/zh: "Existing successor", "already has" wording for the empty/hidden state
- [x] 4.5 Component test `front-end/src/views/documents/document-detail-successor-gate.spec.ts`: taken pairing not offered + link shown; cancelled successor → offered again; server 409 → error shown and detail re-fetched

## 5. Specs & verification

- [x] 5.1 Run backend unit + concurrency tests, frontend vitest, `openspec validate`
- [x] 5.2 Verify in the dev stack: create a `PO` from a `PR` twice (second refused), cancel it, create again (allowed); detail shows the successor link
