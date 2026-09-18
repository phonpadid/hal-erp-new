## 1. Schema

- [x] 1.1 `document.entities.ts`: add `MATCH_MODES = ['NONE','TWO_WAY','THREE_WAY']`, `matchMode` (default `THREE_WAY`) with a `@Check` like `post_action`, and `receivesGoods` (default false) on `DocumentType`
- [x] 1.2 `Migration20260919000000.ts`: add both columns + check; backfill `receives_goods = true` for predecessor types of a pairing whose successor type is `CUT_BUDGET`; `down()` drops them
- [x] 1.3 DBML `document_type` + `.snapshot-hal_erp.json`

## 2. Backend

- [x] 2.1 `dto/config.dto.ts`: `matchMode` (`IsIn`) and `receivesGoods` on create/update DTOs; `document-type.service.ts` create/update/read carry them
- [x] 2.2 `document-submit.service.ts`: gate on `document.refDocument && docType.matchMode !== 'NONE'`; remove the `CUT_BUDGET` test
- [x] 2.3 `matching.service.ts`: read the type's `matchMode`; `NONE` → `{ ok: true, lines: [] }`; `TWO_WAY` → skip the received-qty check; remove the post-action branch
- [x] 2.4 `receiving.service.ts`: refuse a receipt on a type with `receivesGoods = false` (400 naming the type code)
- [x] 2.5 Seed: `DISB.matchMode = THREE_WAY` (explicit), `PO.receivesGoods = true`
- [x] 2.6 Tests: `match-mode.spec.ts` (DB-backed) — default THREE_WAY blocks over-receipt; TWO_WAY passes with received 0 but blocks over-amount; NONE runs nothing and a CUT_BUDGET PO from an unpriced PR submits and reserves its own budget; receipt on `receives_goods=false` refused; bad match mode refused by the type service
- [x] 2.7 Update existing specs that relied on the CUT_BUDGET-only rule (matching / receiving suites; set `receivesGoods: true` on their PO fixtures)

## 3. Frontend

- [x] 3.1 `shared/src/index.ts` doc-type schema + `api/docConfig.ts` / `stores/docConfig.ts` types: `matchMode`, `receivesGoods`
- [x] 3.2 `DocTypeFormFields.vue`: `match_mode` Select with hints + `receives_goods` switch; `DocTypeFormView.vue` initial values/defaults
- [x] 3.3 `DocumentDetailView.vue`: `canReceive` also requires `doc.documentType.receivesGoods`; matching panel unchanged (server returns no lines for NONE)
- [x] 3.4 i18n en/la/zh for the two settings, their hints and the three mode labels
- [x] 3.5 Tests: extend `type-flags-configurable.spec.ts` (both settings round-trip through the form); `document-detail-receive-gate.spec.ts` (button hidden when `receivesGoods=false`, shown when true)

## 4. Verification

- [x] 4.1 Backend + frontend tests, `openspec validate`
- [x] 4.2 Dev stack: set a PO type to `NONE`, submit a PO from an unpriced PR without receiving — succeeds; receive button absent on the PR
