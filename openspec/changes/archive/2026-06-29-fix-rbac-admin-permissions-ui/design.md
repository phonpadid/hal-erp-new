## Context

`/rbac-admin` is backed by a single page, `front-end/src/views/admin/RbacAdminView.vue`,
with a **Roles** tab and a **Users** tab, fed by the `useRbacAdminStore`
(`front-end/src/stores/rbacAdmin.ts`) over `rbacApi` (`front-end/src/api/rbac.ts`). Lists
use the shared `AppDataTable` (lazy, `scrollable`, fixed `scrollHeight`).

Today the Roles tab renders a role's grants inline:

```vue
<Column :header="$t('admin.rbac.columns.permissions')">
  <template #body="{ data }">
    <div class="flex flex-wrap gap-1">
      <Chip v-for="p in data.permissions" :key="p.code"
            :label="`${p.code} · ${p.scope}`" removable
            @remove="detachPermission(data.id, p.code)" />
      ...
    </div>
  </template>
</Column>
```

There is no cap, grouping, per-cell scroll, or truncation, so a role with many grants
produces a very tall row that overflows the fixed-height table and shoves the action
column aside. Separately, `loadAll()` fetches `rbacApi.roles(1, 100)` and
`rbacApi.permissions(1, 100)` — a hard `limit=100` — and the add-grant `Select` is fed
`rbac.permissions`, so a catalog larger than 100 is silently truncated and some codes
cannot be granted. `CatalogPermission` already carries `{ code, name, module }`, and
`RoleGrant` carries `{ code, name, scope }`, so module grouping needs no API change.

Constraint: frontend-only. The `RBAC_MANAGE` gate, company scope, and "authorize on
codes, not role names" are unchanged — this only changes presentation and how completely
the catalog is loaded.

## Goals / Non-Goals

**Goals:**
- Keep the roles table row height constant regardless of how many grants a role has.
- Make every catalog permission grantable, grouped by `module`, with filtering.
- Give grants a manage surface that scales: grouped by module, filterable, scrollable,
  with in-place add/remove.
- Preserve i18n (en/la) parity and PrimeUI theme tokens (light/dark).

**Non-Goals:**
- No backend, DTO, or schema change; reuse the existing paged endpoints.
- No change to authorization, scope semantics, or the Users/assignments tab.
- No virtualized/infinite-scroll rendering — a fixed-height scroll region is sufficient.

## Decisions

### 1. Compact summary cell + dedicated manage-permissions dialog

The permissions column renders a **bounded summary**: a grant count and at most a few
grant labels, plus a **Manage** button (carrying the "+N more" sense). Clicking it opens a
per-role manage-permissions `Dialog` that absorbs both viewing and editing — replacing the
inline chip cloud and the current standalone "Add grant" dialog.

Inside the dialog:
- Grants are grouped by `module` (collapsible sections, with a per-module count), derived
  by grouping `role.permissions` — module comes from joining against the catalog by `code`
  (the catalog is fully loaded; see decision 3).
- An `InputText` filter narrows grants by code/name.
- The grant list sits in a fixed-height, vertically scrollable container (PrimeUI tokens,
  e.g. `max-h-*` + `overflow-y-auto`), so it never grows the page.
- Each grant row has a remove control calling the existing `detachPermission(roleId, code)`.
- The add-grant `Form` (permission `Select` + scope `Select`) lives at the top/bottom of the
  same dialog and calls the existing `attachPermission` flow.

*Alternative considered:* inline grouped chips with per-cell expand/scroll. Rejected — it
keeps unbounded content in a table cell, fighting the fixed table scroll height, and is
harder to filter. The dialog matches the existing dialog-driven pattern on this page and is
robust to hundreds of grants. (User-confirmed choice.)

### 2. Group the permission picker by module

The add-grant `Select` switches to grouped options using PrimeVue's option-group API
(`:options` as `[{ module, items: [...] }]`, `optionGroupLabel="module"`,
`optionGroupChildren="items"`), keeping `filter`, `optionLabel="code"`, and
`optionValue="code"`. A computed groups `rbac.permissions` by `module` (stable, localized
group headers). This makes a large catalog navigable instead of one flat 100-item list.

### 3. Load the full catalog and all roles, not one capped page

`loadAll()` stops assuming everything fits in `limit=100`. It pages each of
`rbacApi.roles` / `rbacApi.permissions` to exhaustion: fetch page 1, then while
`items.length < total` fetch subsequent pages and concatenate, using the server's `total`.
This removes the silent truncation while staying within the existing paged endpoints.

*Alternative considered:* raise the cap to a bigger number (e.g. 1000). Rejected — it only
moves the silent-truncation cliff. Paging to `total` is correct for any size. A high
per-request `limit` is still used to keep the number of round-trips small.

### 4. i18n and theming

New strings (`admin.rbac.manage*`, module group headers fallback, `+N more`, filter
placeholder, dialog title, empty states) are added to both `en` and `la` message files.
All new markup uses PrimeUI theme tokens / utility classes — no hardcoded colors — so
light and dark both render.

## Risks / Trade-offs

- [Extra requests when catalog/roles exceed one page] → Paging to `total` adds round-trips
  only past the first page; with a high per-request `limit` this is a few requests at most,
  and only for large companies.
- [Module missing on a grant if catalog not yet loaded] → Group under a localized
  "Ungrouped"/"Other" bucket and key grouping off the catalog once `loadAll()` resolves;
  the dialog opens after data is loaded.
- [Dialog hides grants behind a click vs. at-a-glance scan] → The summary cell still shows
  the count and the first few grants, preserving a quick read; full detail is one click away.
- [Client/server drift] → No new validation rules; the add-grant Zod resolver and scopes
  are unchanged, so client and server stay aligned.

## Migration Plan

Pure frontend, no data migration. Ship the view/store/i18n changes together; the response
shape and endpoints are unchanged, so rollback is reverting the frontend commit. No
feature flag needed.

## Open Questions

- None blocking. (How many grant labels to show inline before "+N more" — e.g. 2–3 — is a
  presentational detail settled during implementation.)
