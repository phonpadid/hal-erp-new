## Why

`master-data` is the third capability in the build order. The scaffold ships the four
entities (`vendor`, `vendor_company`, `item`, `item_company`) but no behavior. The
document engine will need to (a) pick vendors/items that are actually enabled for the
active company and (b) default a document line's GL account from the item. This change
turns the registries into a working capability — group-wide masters with per-company
enablement — and exposes the guards/lookups document-engine will call.

## What Changes

- **`MasterDataModule`** registering the four entities, with services + controllers.
- **Group vendor registry**: CRUD for `vendor` (group-wide, guarded by `MASTER_MANAGE`)
  with credit terms (`payment_term_days`); deactivate-not-delete via `is_active`.
- **Per-company vendor enablement**: enable/disable a vendor for the active company via
  `vendor_company` (records `approved_date`); list a company's enabled vendors;
  `assertVendorEnabled(vendorId, companyId)` guard that document-engine calls before
  accepting a vendor on a document — rejects vendors not enabled for that company.
- **Group item registry**: CRUD for `item` (group-wide) with `default_gl_account`;
  deactivate-not-delete.
- **Per-company item enablement**: enable/disable items for the active company via
  `item_company`; list enabled items; `assertItemEnabled(itemId, companyId)` guard.
- **GL defaulting helper**: `defaultGlAccountFor(itemId)` returning the item's
  `default_gl_account` so a document line can pre-fill it (editable downstream).
- **Enforcement**: every endpoint authorizes by permission code; the per-company
  enablement tables (`vendor_company`, `item_company`) are company-scoped — reads/writes
  bound to the active company via `CompanyScopeService`. List endpoints for enabled
  vendors/items use rbac's `ScopeService` (first real consumer) so visibility honors the
  caller's data scope on top of company isolation.

No schema change — the four entities already match the DBML.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `master-data`: adds the API-surface and enforcement requirements the existing two
  requirements implied but did not pin down — vendor/item deactivation (no hard delete),
  the per-company enable/disable operations, and the rule that all endpoints authorize by
  permission code and apply company scope to the enablement tables. The two existing
  requirements (Group Vendor Registry, Group Item Registry) are unchanged.

## Impact

- **Affected capability**: `master-data` (unblocks document-engine's vendor/item
  selection and GL defaulting).
- **Invariants exercised**: 1 (company isolation — enablement tables are company-scoped;
  a vendor/item must be enabled for the active company to be usable), 5 (permission codes
  `MASTER_VIEW` / `MASTER_MANAGE`).
- **Code**: new `back/src/modules/master-data/` services, controllers, DTOs, module;
  registered in `AppModule`. First real use of rbac `ScopeService`.
- **New permission codes**: `MASTER_VIEW`, `MASTER_MANAGE`.
- **Dependencies**: none new; uses MikroORM, class-validator, the existing scope/auth
  seams and rbac `ScopeService`.
- **Consumers (later)**: document-engine calls `assertVendorEnabled` /
  `assertItemEnabled` / `defaultGlAccountFor`; these are delivered and unit-tested here.
