## 1. Shared schemas (single source of truth)

- [x] 1.1 In `@erp/shared` (`shared/src/index.ts`), add `vendorSchema` and `itemSchema` (Zod) mirroring the backend DTOs: vendor requires `vendorCode` + `name` (others optional, `paymentTermDays` a non-negative int); item requires `itemCode` + `name`. Export inferred types.
- [x] 1.2 Shared test: each schema accepts a valid record and rejects a missing required field and a negative `paymentTermDays`. `pnpm --filter @erp/shared build`.

## 2. Frontend data layer

- [x] 2.1 `api/masterData.ts`: `vendors` and `items` namespaces — `list()`, `enabled()`, `create(dto)`, `update(id, dto)`, `enable(id)`, `disable(id)`, `remove(id)`.
- [x] 2.2 `stores/masterData.ts` (Pinia): `vendors`, `items`, `loading`, `error`; `loadVendors()/loadItems()` fetch list + enabled and mark each row `enabled` (id set membership); `saveVendor/saveItem` (create vs update by id presence); `setVendorEnabled/setItemEnabled` (enable/disable then refresh); capture errors.

## 3. View & shell

- [x] 3.1 `views/master/MasterDataView.vue`: PrimeVue `Tabs` (Vendors / Items); each tab a `DataTable` (code, name, key fields, an "Enabled here" `ToggleSwitch`, Edit) + a "New" button — manage controls gated by `can('MASTER_MANAGE')`; empty + error states.
- [x] 3.2 Create/Edit `Dialog` with `<Form :resolver="zodResolver(schema)" @submit>` + `<FormField>` + `<Message v-if="$form.<field>?.invalid">` (per CLAUDE.md), using the shared schemas; save via the store.
- [x] 3.3 Routing + nav: route `master-data` (`meta.permission='MASTER_VIEW'`); a "Master data" nav item gated by `can('MASTER_VIEW')`.

## 4. Frontend tests

- [x] 4.1 Master-data store (mock `api`): `loadVendors` merges the enabled flag (record in `/enabled` → enabled true, others false); `saveVendor` calls create with no id and update with an id; `setVendorEnabled(true/false)` calls enable/disable and refreshes; an error is captured.

## 5. Verify

- [x] 5.1 `pnpm --filter @erp/shared build`, `pnpm --filter @erp/shared test` (if present), `pnpm --filter front-end build` + `pnpm --filter front-end test`, and `pnpm --filter back build` + `pnpm --filter back test` pass.
- [x] 5.2 Run `openspec validate web-master-data --type change --strict`.
