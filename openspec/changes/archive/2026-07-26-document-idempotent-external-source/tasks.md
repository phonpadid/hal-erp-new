## 1. Canonical model first

- [x] 1.1 Add `source_type varchar` and `source_id varchar` to `Table document` in
  `erp_approval_system.dbml`, both nullable, with a note saying they name the external system and
  its own identifier and that the pair is what makes creation idempotent — mirroring the note
  already on `journal_entry`.
- [x] 1.2 Add the index to the same block: `(company_id, source_type, source_id)` unique, noting
  in the DBML that it is partial (`WHERE source_id IS NOT NULL`) so web-app documents stay
  unconstrained.

## 2. Entity and migration

- [x] 2.1 Add the two optional properties to the `Document` entity in
  `back/src/modules/document/document.entities.ts`, with a comment stating the contract: opaque to
  this system, set only by the caller, both or neither.
- [x] 2.2 Generate a migration adding the two nullable columns. Confirm it alters no existing
  column and backfills nothing — every current row simply has both null.
- [x] 2.3 Add the partial unique index in BOTH places: hand-written in the migration, and declared
  on the entity as `@Index({ name, expression })` carrying the same SQL. Entity-only would miss an
  already-migrated database; migration-only would mean no spec can ever exercise it, because specs
  build their schema from entity metadata via `refreshDatabase()`. Found the hard way — the
  concurrency test created two documents and passed.
- [x] 2.4 Run `pnpm --filter back migration:up` against a scratch database and confirm the index
  exists and permits many rows with null `source_id`.

## 3. Accept the pair on create

- [x] 3.1 Add `sourceType` and `sourceId` to `CreateDocumentDto` as optional validated strings.
- [x] 3.2 Validate them as a pair — one without the other is a `400`, not a silently ignored
  field.

## 4. Make creation idempotent

- [x] 4.1 In `createDraft`, before anything else and specifically before `numbering.next()`, look
  up an existing document by `(active company, sourceType, sourceId)` when both are present. If one
  exists, return it immediately: no number issued, no row written, no field values applied.
- [x] 4.2 Wrap the insert so a unique-violation from the partial index is caught, re-read by the
  same key, and the winning document returned. A losing caller must receive the document, not a
  `500`.
- [x] 4.3 Leave every other path untouched — a create without the pair must take exactly the code
  path it takes today.

## 5. Prove it

- [x] 5.1 DB-backed spec: creating twice with the same `(sourceType, sourceId)` returns the same
  document id and leaves exactly one row.
- [x] 5.2 Spec: the second call consumes no document number — assert `doc_running_number.current_no`
  is unchanged across the retry.
- [x] 5.3 Spec: a repeated request carrying different field values returns the stored document
  unchanged.
- [x] 5.4 Spec: the same `source_id` in a different company creates a separate document.
- [x] 5.5 Spec: a create with only one of the pair is rejected.
- [x] 5.6 Spec: a create with neither behaves exactly as before (regression guard for the web app
  path).
- [x] 5.7 **Concurrency spec** — two `createDraft` calls for the same source running concurrently
  end with exactly one document, and both callers receive it. The repo requires a concurrency test
  wherever numbering is touched, and this path touches it.
- [x] 5.8 Spec: a submitted document's reservation is not duplicated by a retried create — one
  `budget_txn` RESERVE row for the source, not two.

## 6. Verify

- [x] 6.1 Run the full `pnpm --filter back test` and confirm no regression.
- [x] 6.2 Run `pnpm --filter back boot:check` — the DI container is not exercised by specs, and
  this change touches a service constructor's surroundings.
- [x] 6.3 Re-read the delta spec against the implementation and confirm each scenario describes
  something the code actually does, then archive through `/opsx:archive` rather than editing
  `openspec/specs/document-engine/spec.md` by hand.
