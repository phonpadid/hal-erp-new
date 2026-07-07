## Context

master-data backend is complete: `/vendors` and `/items` each have list/get/create/update/
delete (`MASTER_VIEW` reads, `MASTER_MANAGE` writes), an `/enabled` read (records enabled for
the active company), and `/:id/enable` · `/:id/disable` (writing `vendor_company`/`item_company`).
Vendor = `{ vendorCode!, name!, taxId?, address?, contactName?, contactPhone?, paymentTermDays?,
isActive }`; Item = `{ itemCode!, name!, category?, defaultUnit?, defaultGlAccount?, isActive }`.
The Vue shell gives `can()`, the typed-api/store pattern, and CLAUDE.md mandates forms use
`@primevue/forms` + `zodResolver` with one Zod schema per form (shared as the source of truth).
`@primevue/forms`, `zod`, and the `@erp/shared` package are already present. CreateDocumentView
already consumes `/items/enabled`, so managing enablement directly affects document creation.

## Goals / Non-Goals

**Goals**
- Browse the vendor + item registries with per-row enabled-for-company state (`MASTER_VIEW`).
- Create/edit via `@primevue/forms` + `zodResolver`, schemas shared in `@erp/shared`.
- Enable/disable per active company (`MASTER_MANAGE`).
- Tests: shared schema validation + the master-data store.

**Non-Goals**
- Per-company GL/term overrides, bulk import, vendor approval lifecycle, other master types.

## Decisions

### D1 — Shared Zod schemas (single source of truth)
Add `vendorSchema` and `itemSchema` to `@erp/shared` (`shared/src/index.ts`), mirroring the
backend DTOs: vendor requires `vendorCode` + `name` (others optional, `paymentTermDays` a
non-negative int); item requires `itemCode` + `name`. The frontend forms use these via
`zodResolver(...)`; if the backend later adopts the same package for its DTOs, both sides stay in
lockstep (CLAUDE.md's parity rule). *Alternative:* duplicate schemas in the frontend — rejected;
that's exactly the drift the rule warns against.

### D2 — Frontend data layer
`api/masterData.ts` with two namespaces (`vendors`, `items`), each:
`list()`, `enabled()`, `create(dto)`, `update(id, dto)`, `enable(id)`, `disable(id)`,
`remove(id)`. `stores/masterData.ts` (Pinia): `vendors`, `items` (each an array), `loading`,
`error`; `loadVendors()/loadItems()` fetch the full list **and** the enabled list, then mark each
row with an `enabled` boolean (set membership by id). Actions `saveVendor`/`saveItem`
(create or update), `setVendorEnabled(id, on)`/`setItemEnabled(id, on)` call enable/disable then
refresh; capture server errors.

### D3 — Tabbed view + dialog form
`views/master/MasterDataView.vue` with PrimeVue `Tabs` (Vendors / Items). Each tab is a
`DataTable` (code, name, key fields, an "Enabled here" `ToggleSwitch`, an Edit button) with a
"New" button — all manage controls gated by `can('MASTER_MANAGE')`. Create/Edit opens a
`Dialog` containing a `<Form :resolver="zodResolver(schema)" @submit>` with `<FormField>`s and
`<Message v-if="$form.<field>?.invalid">`, per CLAUDE.md. One small `VendorForm`/`ItemForm` (or a
shared field set) keeps it tidy. The toggle calls `setEnabled`; the row reflects the result.

### D4 — Enabled state derivation
The global list endpoint returns all records; `/enabled` returns those active for the company.
The store computes `enabled = enabledIds.has(record.id)` per row. Toggling calls enable/disable
and re-fetches both lists (cheap; small data) so the row state is authoritative from the server.

### D5 — Routing & nav
Route `master-data` (`meta.permission='MASTER_VIEW'`); a "Master data" nav item gated by
`can('MASTER_VIEW')`. Visible to seeded `admin` (MASTER_MANAGE → full) and `requester`
(MASTER_VIEW → browse only); `approver` lacks `MASTER_VIEW` so the entry is hidden.

### D6 — Tests
- Shared (`shared`): `vendorSchema`/`itemSchema` accept a valid record and reject a missing
  required field / a negative `paymentTermDays`.
- Frontend (Vitest): master-data store with a mocked api — `loadVendors` merges the enabled flag
  (a record in `/enabled` is marked enabled, others not); `saveVendor` calls create vs update by
  presence of id; `setVendorEnabled(true/false)` calls enable/disable and refreshes; error
  captured. Build (`vue-tsc`) is the type gate.

## Risks / Trade-offs

- **Two fetches per tab load** (all + enabled) — trivial at demo scale; the enabled set is the
  authoritative source for the flag, avoiding client guesswork.
- **Shared package build** — adding schemas means `@erp/shared` must rebuild/typecheck before the
  frontend; the workspace already links it, so `pnpm -r build` ordering handles it; verified at
  apply.
- **Delete vs disable** — expose disable (reversible, company-scoped) prominently; `DELETE` is
  available but hidden behind a confirm to avoid removing a globally-referenced master.

## Migration Plan

`shared`: add the two Zod schemas + tests; `pnpm --filter @erp/shared build`. Frontend: add
`api/masterData.ts`, `stores/masterData.ts`, `MasterDataView.vue` (+ form), router/nav, tests;
`pnpm --filter front-end build/test`. Backend untouched. Validate `openspec validate
web-master-data --type change --strict`. Rollback = revert the `front-end/` + `shared/` additions.

## Open Questions

- One "Master data" route with tabs, or separate `/vendors` + `/items` nav entries? Default: one
  tabbed route (less nav clutter; both share the pattern).
- Surface `DELETE`? Default: yes but behind a confirm dialog, secondary to disable.
