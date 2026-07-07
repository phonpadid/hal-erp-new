## 1. Load the full catalog and roles (store)

- [x] 1.1 In `front-end/src/stores/rbacAdmin.ts`, add a helper that pages an endpoint to exhaustion (fetch page 1, then while `items.length < total` fetch next pages and concatenate) using a high per-request `limit` to minimize round-trips
- [x] 1.2 Rewrite `loadAll()` to load **all** roles and **all** catalog permissions via that helper (drop the hard `limit=100`); keep users on the existing paged path; update the stale `limit=100` comment
- [x] 1.3 Verify `roles` and `permissions` in state now hold the complete sets (no silent truncation past 100)

## 2. Compact grants summary in the roles table

- [x] 2.1 In `RbacAdminView.vue` Roles tab, replace the unbounded `flex flex-wrap` chip cloud in the permissions column with a bounded summary: a grant count, at most a few grant labels, and a **Manage** button that carries the "+N more" sense; keep the `noGrants` empty state
- [x] 2.2 Ensure the cell has a constant height (no wrapping growth) so the row no longer balloons with many grants
- [x] 2.3 Wire the Manage button to open the new manage-permissions dialog for that role

## 3. Manage-permissions dialog (per role)

- [x] 3.1 Add a manage-permissions `Dialog` keyed by role; group the role's grants by permission `module` (join grants to the loaded catalog by `code`; bucket unknown module under a localized "Other")
- [x] 3.2 Add an `InputText` filter over the grant list (by code/name) and render grants inside a fixed-height, vertically scrollable container using PrimeUI tokens/utilities (no hardcoded colors)
- [x] 3.3 Render collapsible per-module sections with a per-module count; each grant row shows `code · scope` with a remove control calling the existing `detachPermission(roleId, code)`
- [x] 3.4 Fold the add-grant `Form` (permission `Select` + scope `Select`) into this dialog and call the existing `attachPermission` flow; remove the now-redundant standalone "Add grant" dialog

## 4. Grouped, untruncated permission picker

- [x] 4.1 Add a computed that groups `rbac.permissions` by `module` into `[{ module, items }]`
- [x] 4.2 Switch the add-grant permission `Select` to grouped options (`optionGroupLabel`/`optionGroupChildren`), keeping `filter`, `optionLabel="code"`, `optionValue="code"`; confirm every catalog code is selectable when the catalog exceeds one page

## 5. i18n and theming

- [x] 5.1 Add new strings (dialog title, manage label, "+N more" / count, module group headers fallback, filter placeholder, empty states) to both `en` and `la` message files with parity
- [x] 5.2 Confirm all new markup uses PrimeUI theme tokens so light and dark mode both render correctly

## 6. Verify

- [ ] 6.1 Manually verify on `/rbac-admin`: a role with many grants keeps a constant-height row; the manage dialog groups/filters/scrolls and add+remove work; the picker lists the full catalog grouped by module
- [x] 6.2 Confirm the `RBAC_MANAGE` gate, company scope, and active-company switching behavior are unchanged
