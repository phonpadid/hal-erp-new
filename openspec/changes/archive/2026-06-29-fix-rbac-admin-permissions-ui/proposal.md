## Why

On `/rbac-admin` the Roles tab renders **every** permission grant of a role as a
removable `Chip` inside a single `flex flex-wrap` cell, with no cap, grouping, scroll,
or truncation. A role with many grants balloons that one row vertically, overflowing the
fixed-height scrollable table and pushing the action column off-screen — the layout
"breaks" exactly as reported. Two related scaling limits make it worse: the grant picker
and the role/catalog data are fetched at a hard `limit=100`, so beyond 100 permissions
the catalog is silently truncated and some codes become un-grantable.

This is a **frontend-only** UX fix in the `rbac` area. It changes how grants are
presented and how the full catalog is loaded; it does not touch authorization, company
scope, or any backend invariant.

## What Changes

- **Compact grants column.** The Roles table cell shows a bounded summary — a grant count
  plus the first few grants and a "+N more" / **Manage** affordance — so row height stays
  constant no matter how many grants a role has.
- **Manage-permissions dialog (per role).** A dedicated dialog lists *all* of the role's
  grants **grouped by permission module**, with a text filter and a fixed-height scroll
  region, a remove control per grant, and the add-grant form folded into the same dialog.
  This replaces the inline chip cloud and the standalone "Add grant" dialog.
- **Grouped, untruncated permission picker.** The add-grant `Select` groups its options by
  `module` (PrimeVue option groups), keeps its filter, and is fed the **complete** permission
  catalog rather than a single 100-row page, so every code is selectable.
- **No silent catalog/role truncation.** The store loads the full permission catalog (and
  all roles) by paging to exhaustion instead of requesting one hard-capped page; the
  misleading `limit=100` assumption is removed.
- All new chrome (dialog title, module group headers, filter placeholder, "+N more",
  empty states) comes from i18n with en/la parity and uses PrimeUI theme tokens.

## Capabilities

This change touches one of the nine domain capabilities: **rbac** (its web surface,
`web-rbac-admin`). It does not alter rbac authorization rules — codes-not-role-names,
company scope, and the `RBAC_MANAGE` gate are all unchanged.

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-rbac-admin`: the Role and Permission Management requirement gains scalability
  behavior — a role's grants are presented so the layout holds for any number of grants
  (compact summary in the list, a grouped/filterable/scrollable manage dialog), and the
  permission picker offers the **full** catalog grouped by module without silent
  truncation.

## Impact

- **Frontend only.** `front-end/src/views/admin/RbacAdminView.vue` (Roles tab cell +
  manage/grant dialogs), `front-end/src/stores/rbacAdmin.ts` (load the full catalog/roles
  instead of `limit=100`), possibly a small presentational sub-component for the grant
  list, and i18n message files (en/la).
- **No backend change.** Existing `GET /rbac/roles` and `GET /rbac/permissions` paged
  endpoints are reused; the client simply pages through them. No DB/migration change.
- **Invariants honored.** Authorization still keys on permission **codes** (invariant 6);
  the view stays company-scoped and `RBAC_MANAGE`-gated (UX only, server authoritative);
  no ledger or money behavior is involved.
- **Risk:** low — presentational. The only data-flow change is paging the catalog to
  completion, which costs extra requests only when a company has >100 permissions/roles.
