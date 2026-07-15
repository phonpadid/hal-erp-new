## 1. Schema & Entity

- [x] 1.1 Add `document_type_ref` table to `erp_approval_system.dbml` — columns `id uuid [pk]`, `company_id uuid [not null]`, `predecessor_type_id uuid [not null]`, `successor_type_id uuid [not null]`, unique index `(company_id, predecessor_type_id, successor_type_id)`, with an explanatory Note
- [x] 1.2 Add the `Ref:` lines: `document_type_ref.company_id > company.id`, `document_type_ref.predecessor_type_id > document_type.id`, `document_type_ref.successor_type_id > document_type.id`
- [x] 1.3 Create the MikroORM `DocumentTypeRef` entity mirroring the DBML (company + two `@ManyToOne(() => DocumentType)` refs), placed with the document module entities
- [x] 1.4 Generate the schema migration for the new table (unique index + FKs)

## 2. DB-backed helpers

- [x] 2.1 Rewrite `isRefPairingAllowed()` in `ref-chain.config.ts` to an async, company-scoped `document_type_ref` lookup keyed by predecessor/successor **type ids** (not code)
- [x] 2.2 Rewrite `successorTypesFor()` to return the active company's successor `DocumentType`s (or ids/codes) for a predecessor type, scoped by `company_id`
- [x] 2.3 Remove the hardcoded `REF_CHAIN` object and its doc comment
- [x] 2.4 Update `document.service.ts` create-from validation call site to pass `em` + active company + the loaded predecessor type id (resolve by id, avoiding the populate-stub pitfall)
- [x] 2.5 Update `post-action.service.ts` `CREATE_PO` to call the DB-backed `successorTypesFor` within its transaction and keep the "exactly one successor → create, else logged no-op" rule
- [x] 2.6 Rework `ref-chain.spec.ts` to exercise the DB-backed helpers (allowed pairing true, wrong direction false, unknown false, cross-company false)

## 3. Seeding & data back-fill

- [x] 3.1 In the seed (`back/src/seed/seed-data.ts`) create `document_type_ref` rows per company for `PR→PO`, `PROC→PO`, `PO→DISB`, `ADVANCE→CLEAR_ADVANCE`, resolving each side by `(company_id, code)` and skipping any company missing a type
- [x] 3.2 Add the same back-fill as a data step in the migration for existing databases
- [x] 3.3 Verify seeded data reproduces the previous `CREATE_PO` (PR→PO) and create-from behavior end-to-end

## 4. Admin API

- [x] 4.1 Add DTOs (class-validator) for listing/adding/removing pairings; add the matching Zod schema to the shared package as the single source of truth
- [x] 4.2 Add service methods (company-scoped) to list a type's successor & predecessor pairings, add a pairing, and delete a pairing
- [x] 4.3 Enforce same-company validation: reject a pairing whose `predecessor_type`/`successor_type` are not both in the active company; rely on the unique index to reject duplicates
- [x] 4.4 Expose REST endpoints in the document-type config controller, each guarded by the `DOC_CONFIG_MANAGE` permission code and `ParseUUIDPipe` on id params
- [x] 4.5 Unit-test the service rules: same-company enforcement, duplicate rejection, company-scoped listing, cross-company not-found

## 5. Admin UI

- [x] 5.1 Add a reference-chain pairings section to the document-type config editor (Vue 3 `<script setup>` / PrimeVue) showing successor and predecessor pairings for the selected type
- [x] 5.2 Add/remove pairings using a picker limited to active-company types and excluding the type itself; wire to the typed API client with the company-context JWT
- [x] 5.3 Show/hide the editor by the `DOC_CONFIG_MANAGE` permission code from the Pinia active-company context; block duplicate adds client-side (server still enforces)
- [x] 5.4 Validate the form with the shared Zod schema via `zodResolver`; surface errors with `<Message>`

## 6. Verification

- [x] 6.1 Run backend unit tests (helpers, service rules) and confirm green
- [x] 6.2 Manually verify the create-from and `CREATE_PO` flows on seeded data, and adding a new chain via the UI enables a new create-from with no code change
- [x] 6.3 Confirm company isolation: a pairing in company A does not permit create-from in company B
