## Context

The scaffold provides `vendor`, `vendor_company`, `item`, `item_company` and the
cross-cutting seams (company filter on `CompanyScopedEntity`, `CompanyScopeService`,
permission-code guard, rbac `ScopeService`). `multi-company` and `rbac` are implemented.
This slice adds behavior only — no schema change.

`vendor` and `item` are group-wide (`BaseEntity`, no `company_id`). `vendor_company` and
`item_company` are `CompanyScopedEntity` — the per-company enablement join, flowing
through the company filter.

## Goals / Non-Goals

**Goals**
- CRUD for the two group registries (deactivate-not-delete).
- Per-company enable/disable via the join tables, company-scoped.
- Guards `assertVendorEnabled` / `assertItemEnabled` and `defaultGlAccountFor` for
  document-engine to consume; delivered + unit-tested.
- All endpoints permission-gated; enablement reads/writes bound to the active company.
- First real use of rbac `ScopeService` on the "enabled vendors/items" list reads.

**Non-Goals**
- Vendor approval workflow (the `document` of type "vendor registration" is a later
  document-engine concern); `approved_date` here is just a stamp set on enablement.
- Bulk import (CSV) of vendors/items.
- Item pricing / price lists, vendor bank details, contacts beyond the existing columns.
- Wiring the guards into real document submission (document-engine's job).

## Decisions

### D1 — Group registries are permission-gated; enablement tables are company-scoped
`vendor` / `item` CRUD is gated by `MASTER_MANAGE` (writes) / `MASTER_VIEW` (reads) with
no row filter (group-wide). `vendor_company` / `item_company` operations go through
`CompanyScopeService.forActiveCompany()`, so a row is created/read for the JWT's active
company and a write targeting another company is impossible (filter-bound). Mirrors the
multi-company pattern (root entity vs company-scoped).

### D2 — Enable = upsert-then-activate; disable = soft
Enabling a vendor for the active company finds an existing `vendor_company` (vendor,
company) row and sets `is_active = true` (+ `approved_date` if absent), or creates one.
Disabling sets `is_active = false` (the row is kept for history). Same for items. This
keeps enablement idempotent and reversible without losing the approval stamp.

### D3 — Selectability guards (what document-engine calls)
- `assertVendorEnabled(vendorId, companyId?)`: the vendor must be `is_active` AND have an
  `is_active` `vendor_company` row for the active company; else `BadRequestException`.
- `assertItemEnabled(itemId, companyId?)`: same shape against `item_company`.
- `defaultGlAccountFor(itemId)`: returns the item's `default_gl_account` (or null),
  loaded group-wide. The line keeps it editable — this only supplies the default.
These live in the services and are unit-tested now; document-engine imports them later.

### D4 — `ScopeService` first consumer on enabled-list reads
The "list enabled vendors/items for the active company" reads call
`ScopeService.scopeWhere(code, fields)` after the company filter, proving the rbac scope
seam end-to-end. For master enablement the natural scope is COMPANY (no owner/department
column on the join), so OWN/DEPARTMENT degrade to no-op-safe filters; the test exercises
COMPANY scope returning the company's rows. Document-heavy scopes (OWN/DEPARTMENT) get
their real workout in document-engine.

### D5 — DTOs: class-validator
Create/update vendor and item DTOs (class-validator, `ParseUUIDPipe` on id params).
Enable/disable take the target master id from the path and the active company from
context — no company id in the body (consistent with multi-company/rbac admin).

## Risks / Trade-offs

- **Scope on enablement tables is coarse** (only COMPANY is meaningful — no owner/dept
  columns). → Mitigation: `ScopeService.scopeWhere` already degrades safely; document
  it, and rely on document-engine to exercise finer scopes. Avoids forcing an unnatural
  scope onto master data.
- **`approved_date` is a stamp, not an approval flow** → documented as a non-goal; a real
  vendor-registration document can supersede it later without a schema change.
- **Hard vs soft delete on join rows** → disable is soft (`is_active=false`) to preserve
  the `approved_date` and audit; consistent with deactivate-not-delete.

## Migration Plan

No DB migration. Steps: add `MasterDataModule` (services, controllers, DTOs, permission
constants); register in `AppModule`; add unit/integration tests; `pnpm build` +
`pnpm test`. Rollback = revert the module (no data/schema impact).

## Open Questions

- Should listing group `vendor`/`item` (the registry, not enablement) be filtered to the
  caller's company at all? Default: no — the registry is group-wide and gated by
  `MASTER_VIEW`; only the enablement lists are company-scoped. (Matches the spec: masters
  are shared once, controlled per company.)
