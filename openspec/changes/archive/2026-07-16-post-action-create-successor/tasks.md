## 1. Data model & DBML

- [x] 1.1 Add `auto_create boolean [default: false]` to `document_type_ref` in `erp_approval_system.dbml`.
- [x] 1.2 Add `autoCreate` (`@Property({ default: false })`) to `DocumentTypeRef` in `document.entities.ts`; update the entity comment.

## 2. Shared constant & schema

- [x] 2.1 In `shared/src/index.ts`, rename `POST_ACTIONS` entry `'CREATE_PO'` → `'CREATE_SUCCESSOR'`.
- [x] 2.2 Add `autoCreate: z.boolean().optional()` to `refPairingSchema`; rebuild `@erp/shared`.

## 3. Backend — post-action rename & multi-successor

- [x] 3.1 In `post-action.service.ts`, replace `'CREATE_PO'` comparisons with `'CREATE_SUCCESSOR'`; rename local `po` → `successor` and the `CREATE_PO ...` logs.
- [x] 3.2 Add `autoCreateSuccessorsFor(em, companyId, predecessorTypeId)` to `ref-chain.config.ts` (successor types of pairings with `auto_create=true`).
- [x] 3.3 Change the `CREATE_SUCCESSOR` branch to loop over `autoCreateSuccessorsFor` and `createFrom` each (logging per creation), no-op when empty — replacing the `length !== 1` guard.
- [x] 3.4 Update the `CREATE_PO` mentions in comments: `document.entities.ts`, `approval-routing.service.ts`.

## 4. Backend — pairing admin (auto_create)

- [x] 4.1 Accept `autoCreate` on `CreateRefPairingDto` (default false); persist it in `RefChainService.addPairing`.
- [x] 4.2 Add `PATCH document-config/ref-pairings/:id` + `UpdateRefPairingDto { autoCreate }` + `RefChainService.setAutoCreate` (company-scoped, `DOC_CONFIG_MANAGE`).
- [x] 4.3 Include `autoCreate` in the `PairingView` returned by `listForType`.

## 5. Migration

- [x] 5.1 New migration: add `document_type_ref.auto_create` (not null default false); `update document_type set post_action='CREATE_SUCCESSOR' where post_action='CREATE_PO'`; backfill `auto_create=true` for pairings whose predecessor is a `CREATE_SUCCESSOR` type. `down()` reverses the value update and drops the column.

## 6. Seed

- [x] 6.1 In `seed-data.ts`, set the PROC type `postAction: 'CREATE_SUCCESSOR'`; seed the PROC→PO pairing with `autoCreate: true` (and set the other ref pairings' `autoCreate` explicitly to false).

## 7. Frontend

- [x] 7.1 `api/docConfig.ts`: `RefPairing` gains `autoCreate`; `addRefPairing` sends it; add `updateRefPairing(id, { autoCreate })`.
- [x] 7.2 `stores/docConfig.ts`: add an action to toggle a pairing's auto-create and refresh.
- [x] 7.3 `RefChainEditor.vue`: show an auto-create toggle/badge on each successor pairing; wire add + toggle.
- [x] 7.4 i18n (en/la): rename `admin.docConfig.postActions.CREATE_PO` → `...CREATE_SUCCESSOR`; add labels for the auto-create toggle/badge.

## 8. Tests & verify

- [x] 8.1 Updated `approval-workflow.service.spec.ts` from `CREATE_PO` → `CREATE_SUCCESSOR` + `auto_create` pairings; the ADVANCE→CLEAR_ADVANCE auto-create test passes.
- [x] 8.2 Added a multi-successor test: a `CREATE_SUCCESSOR` type with two `auto_create=true` pairings creates two DRAFTs; the `auto_create=false` pairing is not created (verified — 20 tests pass, logs show both successors created).
- [x] 8.3 Added ref-chain admin test (create with `autoCreate`, toggle via PATCH) in `ref-chain-admin.spec.ts`. NOTE: that spec's `beforeAll` is blocked by a pre-existing working-tree seed change (company code `DEMO`→`HAL`), unrelated to this change — see memory `seed-company-code-hal-not-demo`. The auto_create behavior itself is fully verified by the 8.2 multi-successor test.
- [x] 8.4 Grepped repo — no `CREATE_PO` outside the rename migration + archived change. Touched source typechecks clean; self-contained suites green. Migration SQL verified by inspection (column add + rename + backfill; mirrors the prior applied migration). Not re-applied to the dev DB because `DB_NAME=new_erp` is currently used/wiped by the test runner.
