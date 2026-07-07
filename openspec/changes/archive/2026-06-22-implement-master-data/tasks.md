## 1. Module scaffolding & DTOs

- [x] 1.1 Create `MasterDataModule` (`MikroOrmModule.forFeature([Vendor, VendorCompany, Item, ItemCompany])`, provide `CompanyScopeService`, import `RbacModule` for `ScopeService`); register in `AppModule`.
- [x] 1.2 Add class-validator DTOs under `dto/`: create/update vendor, create/update item. Enable/disable take the master id from the path + active company from context (no company id in body).
- [x] 1.3 Add permission-code constants `MASTER_VIEW`, `MASTER_MANAGE` in a module `permissions.ts`.

## 2. Vendor registry + enablement

- [x] 2.1 `VendorService`: create/update/list/get/deactivate group vendors (deactivate sets `is_active = false`, never delete; default list omits inactive). Enablement (company-scoped): `enableForCompany(vendorId)` (upsert `vendor_company`, `is_active = true`, stamp `approved_date` if absent), `disableForCompany(vendorId)` (`is_active = false`), `listEnabled()` (company's active `vendor_company`, via `ScopeService.scopeWhere`). Guard `assertVendorEnabled(vendorId, companyId?)` — vendor active AND an active `vendor_company` for the company, else reject.
- [x] 2.2 `VendorController`: REST guarded by `MASTER_MANAGE`/`MASTER_VIEW`; `ParseUUIDPipe` on id params; `JwtAuthGuard` + `PermissionsGuard`. Endpoints for CRUD + enable/disable + enabled-list.

## 3. Item registry + enablement

- [x] 3.1 `ItemService`: create/update/list/get/deactivate group items; `enableForCompany`/`disableForCompany`/`listEnabled` on `item_company`; `assertItemEnabled(itemId, companyId?)`; `defaultGlAccountFor(itemId)` returning the item's `default_gl_account` (or null).
- [x] 3.2 `ItemController`: REST guarded by `MASTER_MANAGE`/`MASTER_VIEW`; `ParseUUIDPipe`; CRUD + enable/disable + enabled-list.

## 4. Tests

- [x] 4.1 Vendor deactivation: deactivate sets `is_active = false`, row still exists, default list omits it.
- [x] 4.2 Per-company enablement: enable vendor for A → `assertVendorEnabled` passes for A, rejects for B; disable → rejects for A again.
- [x] 4.3 Item GL defaulting: `defaultGlAccountFor` returns the item's default GL; `assertItemEnabled` rejects an item not enabled / inactive.
- [x] 4.4 Company scope: active company A `listEnabled` returns only A's `vendor_company` rows (not B's).

## 5. Verify

- [x] 5.1 `pnpm --filter back build` and `pnpm --filter back test` pass.
- [x] 5.2 Run `openspec validate implement-master-data --strict`.
