## Context

The Configuration area lives entirely in `front-end/src/views/admin/DocConfigView.vue`
(~485 lines), a single component that renders four PrimeVue tabs — Document Types, Form
Templates, Department Mappings, Workflows — over one shared `useDocConfigStore` (Pinia).
The app's real chrome is the sakai layout (`AppLayout` → `AppSidebar` → `AppMenu`), whose
left sidebar is driven by the permission-gated `NAV` array and `groupNav()` grouping in
`front-end/src/layouts/store/layout.store.ts` (the earlier-referenced `AppShell.vue` is
legacy/unused). Today `NAV` has a single **Configuration** entry → `/doc-config`, and the
route is a single leaf: `{ path: 'doc-config', name: 'doc-config', meta: { permission:
'DOC_CONFIG_MANAGE' } }`. The user wants the tabs removed and the four sections presented
as directly-linkable entries in that left sidebar.

No backend, DB, ledger, or money flow is involved. This is a frontend navigation and
component-decomposition change only; no `budget_txn`/`quota_usage` write occurs, so there
is no DB transaction boundary or locking concern here.

## Goals / Non-Goals

**Goals:**
- Replace the four tabs with a Configuration sub-sidebar (left nav) visible only inside
  the Configuration area.
- Give each section its own child route so it is directly linkable and reloadable.
- Preserve every existing behavior, permission gate, and the shared store — this is a
  presentation split, not a functional rewrite.
- Keep the single **Configuration** entry in the top nav unchanged.

**Non-Goals:**
- No global left sidebar for the whole app (top nav for other areas stays as-is).
- No change to `useDocConfigStore`, the API layer, DTOs, or any backend.
- No change to what the four sections *do*, or to their permission model.
- No new field types, workflow features, or mapping behavior.

## Decisions

### D1: Four sibling routes + redirect over query params or in-component state
Replace the single `doc-config` leaf with a redirect (`doc-config` → `doc-config/types`)
plus four sibling routes: `doc-config/types`, `doc-config/forms`, `doc-config/mappings`,
`doc-config/workflows`. Each carries `meta: { permission: 'DOC_CONFIG_MANAGE' }` so the
existing `router.beforeEach` guard keeps enforcing it.

- **Why:** per-section routes make each section directly linkable and bookmarkable (a
  stated goal) and reuse the existing route guard unchanged.
- **Alternative considered:** keep one route and drive the active section from a Pinia/URL
  query param. Rejected — no clean per-section URLs; re-implements the router.

### D2: Sidebar entries via the existing `NAV` model (no second sidebar)
The app already has a permission-gated left sidebar built from `NAV`/`groupNav()` in
`layout.store.ts` and rendered by `AppMenu`. Add a dedicated **Configuration** nav section
(`NAV_SECTIONS`) whose four always-visible entries point at the four routes, replacing the
single Configuration entry. Building a second, page-scoped sub-sidebar would duplicate the
chrome the app already has; instead the four sections live in the real sidebar. The four
tab bodies become focused section views — `DocTypesView.vue`, `FormTemplatesView.vue`,
`DeptMappingsView.vue`, `WorkflowsView.vue` (under `views/admin/doc-config/`) — each still
using the shared `useDocConfigStore`, so no data is duplicated.

- **Why:** reuses the established sidebar, grouping, gating, i18n, and theming; a
  root nav section keeps all four sections one click away (matches the frequent-switching
  goal) and shrinks the 485-line monolith into reviewable units.
- **Alternative considered:** a nested collapsible submenu under "Administration".
  Rejected — sakai collapses nested submenus on desktop navigation, hiding the sibling
  sections exactly when the user is switching between them.
- **Alternative considered:** a separate `DocConfigLayout.vue` with its own in-page
  sub-sidebar. Rejected — redundant with the real sidebar.

### D3: Gating and theming reuse the sidebar's existing rules
The four entries are filtered by permission code by `groupNav()` exactly like every other
nav entry (all require `DOC_CONFIG_MANAGE`); the Workflows *section* is visible under
`DOC_CONFIG_MANAGE` while its create/add-step affordances stay gated by `WORKFLOW_MANAGE`
in-view, as today. `AppMenu`/`AppMenuItem` already style the active entry and render in
both light and dark, so no new styling is introduced.

- **Why:** invariant — client nav is UX-only and must mirror server scope; reusing the
  established gating keeps the permission model and theming consistent.

### D4: Repurpose existing i18n keys
Reuse `admin.docConfig.tabs.{types,forms,mappings,workflows}` as the sub-sidebar labels
(rename the `tabs` namespace to `nav` if clearer). Avoids inventing parallel strings.

## Risks / Trade-offs

- **Shared store re-fetch on each section mount could cause redundant loads** → have each
  section request only its slice (e.g. Forms loads templates lazily as it already does),
  and guard `loadAll()` so cached data isn't refetched needlessly.
- **Cross-section state that lived in the single component (e.g. `formsTypeId`,
  `mapTypeId`, dialog refs) would be lost on navigation** → move that transient selection
  state into the owning section view; it is per-section anyway, so scoping it there is
  correct, not a regression.
- **Existing bookmarks/links to `/doc-config`** → the parent `redirect` to the first
  section preserves them; no broken links.
- **Smoke/route tests assume a single `doc-config` route** → update them to the new child
  routes as part of the change (listed in tasks).

## Migration Plan

Frontend-only; ships in one deploy. Steps: add child routes + redirect, extract the four
section views and the layout shell, delete the tab markup, wire the sub-sidebar, update
i18n keys and affected tests. Rollback is reverting the frontend change — no data or API
migration, so rollback is safe at any time.

## Open Questions

- Should the sub-sidebar collapse/stack on narrow viewports, or is the Configuration area
  desktop-only? (Default assumption: responsive stack above content on small screens.)
