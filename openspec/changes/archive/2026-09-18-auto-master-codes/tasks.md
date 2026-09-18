## 1. Schema

- [x] 1.1 `master-data.entities.ts`: add `MasterSequence` entity (`kind` string PK, `currentNo` int default 0), table `master_sequence`
- [x] 1.2 `Migration20260918000000.ts`: create `master_sequence`; insert `VENDOR`/`ITEM` rows with `current_no` = max numeric suffix over `vendor_code ~ '^V-[0-9]+$'` / `item_code ~ '^I-[0-9]+$'` (0 if none); `down()` drops the table
- [x] 1.3 Add `master_sequence` to `erp_approval_system.dbml` and to `.snapshot-hal_erp.json`

## 2. Backend

- [x] 2.1 `master-sequence.service.ts`: `next(kind, em?)` — `lockForUpdate` on the row, increment, flush, return `V-`/`I-` + 5-digit zero-padded number; runs in the caller's transaction when one is passed
- [x] 2.2 `vendor.service.ts` / `item.service.ts`: `create` runs in `inTransaction`, calls `next()` and inserts with the issued code; drop `dto.vendorCode` / `dto.itemCode`
- [x] 2.3 `dto/vendor.dto.ts`, `dto/item.dto.ts`, `shared/src/index.ts`: remove the code from the create DTOs and shared schemas (whitelist rejects it if sent); rebuild `@erp/shared`
- [x] 2.4 Register the service in `master-data.module.ts`
- [x] 2.5 Tests `master-code-sequence.spec.ts` (DB-backed): first vendor is `V-00001`; codes are consecutive; supplied code → 400; concurrent creates get distinct consecutive codes; seeding above legacy `I-00001` yields `I-00002`
- [x] 2.6 Fix any existing spec that posts a code through `VendorService.create` / `ItemService.create`

## 3. Frontend

- [x] 3.1 `MasterDataView.vue`: remove the code `FormField` from the create dialog; show a hint that the code is assigned on save; keep the read-only code on edit; toast names the issued code
- [x] 3.2 i18n en/la/zh: `master.fields.codeAssigned` hint and `master.feedback.createdWithCode`
- [x] 3.3 Component test `master-data-auto-code.spec.ts`: new dialog has no code input + hint; edit dialog shows the code disabled; toast carries the code from the create response

## 4. Verification

- [x] 4.1 Backend + frontend tests, `openspec validate`
- [x] 4.2 Dev stack: create a vendor and an item from the registry, observe `V-00001` / `I-00002`
