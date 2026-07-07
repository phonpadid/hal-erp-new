## Why

PR lines reference vendors and items, but there's no UI to manage them — and a vendor/item must
be **enabled for the active company** before a document can use it (the backend's
`assertVendorEnabled`/`assertItemEnabled` guards). Today the only enabled masters are the seeded
ones. This change adds the master-data screens: browse the global vendor/item registry, create
and edit records, and enable/disable them for the active company — removing the last bit of
friction in document creation.

The master-data backend is already complete (full CRUD + enable/disable + enabled-for-company
reads), so this is a frontend-only change.

## What Changes

- **New capability `web-master-data`** — vendor and item management screens in the Vue shell.
- **Registry browse** (`MASTER_VIEW`): list all vendors and all items, each row showing whether
  it is enabled for the active company; the document line editors already consume the
  `enabled` reads, so this makes that data manageable.
- **Create / edit** (`MASTER_MANAGE`): a form per entity using `@primevue/forms` with a
  `zodResolver`, validated client-side against a Zod schema that mirrors the backend DTO. To
  keep client and server validation from drifting, the schemas live in the shared `@erp/shared`
  package as the single source of truth.
- **Enable / disable for the active company** (`MASTER_MANAGE`): a per-row toggle that calls the
  enable/disable endpoints (writing `vendor_company` / `item_company`), so a master becomes
  usable on this company's documents.
- **Shell integration**: a "Master data" nav entry (gated by `MASTER_VIEW`) opening a tabbed
  view (Vendors / Items); a typed `api/masterData.ts` + a small Pinia store; manage affordances
  shown only with `MASTER_MANAGE`.
- **Tests**: shared-schema validation tests (valid/invalid vendor + item); frontend unit tests
  for the master-data store (list merges the enabled flag; create/enable/disable update state).

## Capabilities

### New Capabilities
- `web-master-data`: the Vue vendor/item registry — browse with enabled-for-company state,
  create/edit via shared-schema-validated forms, and enable/disable per active company,
  permission-gated.

## Impact

- **Affected**: `front-end/` (new tabbed view, store, api, router/nav) and `shared/` (Zod
  schemas for vendor + item, the single source of truth for both sides).
- **Invariants reflected**: 5 (browse `MASTER_VIEW`, manage `MASTER_MANAGE`; server enforces);
  1 (enable/disable scoped to the active company via `vendor_company`/`item_company`); the
  client/server validation parity rule (shared Zod schema).
- **Consumes**: existing `GET/POST/PATCH/DELETE /vendors` and `/items`, their `/enabled`
  reads, and `/:id/enable` · `/:id/disable`. No new endpoint, no schema change.
- **No new dependency** (`@primevue/forms` + `zod` already present).

## Out of Scope

- Per-company default GL / payment-term overrides beyond what the enable endpoints set.
- Bulk import / CSV upload of masters.
- Vendor approval workflow (the `vendor_company.approved_date` lifecycle) — enable/disable only.
- Other master data (currencies, GL accounts) — currencies have their own admin slice later.
