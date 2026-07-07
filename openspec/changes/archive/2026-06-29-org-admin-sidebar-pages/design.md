## Context

`OrgAdminView.vue` (~450 lines) renders four `<TabPanel>`s over a single `useOrgStore`. The store
already exposes independent per-entity slices and loaders (`loadCompanies`, `loadDepartments`,
`loadFiscalYears`, `loadHolidays`) with their own pagination state. The sidebar (`AppMenu` →
`AppMenuItem`) renders a two-level model: `nav.sections.<section>` headers, each with `items` that
carry `{ label, icon, to }`. `NAV_SECTIONS` is an ordered list and `NAV` entries are filtered by
permission code (`groupNav`). Today there is one `organization` NAV entry → `/org-admin` under
`administration`. The router gates routes by `meta.permission`.

Because the store is already partitioned and the sidebar already does section→items, splitting is
mechanical: move each tab's template + its dialog/handlers into its own view, point a route at it,
and add NAV entries under a new section.

## Goals / Non-Goals

**Goals:**
- One routed page per area, grouped under a new **Organization** sidebar section, each gated by
  `COMPANY_VIEW`.
- Preserve every current behaviour exactly: tables, create/edit dialogs, shared-Zod validation, the
  department parent-cycle guard, permission-gated buttons, company scoping, empty/error states.
- `/org-admin` redirects to `/org-admin/companies` (no dead bookmarks); remove the tabbed view.
- Keep each split view lean by sharing the few cross-cutting helpers.

**Non-Goals:**
- No backend/API/DTO/store-data changes; the `org` store is reused as-is.
- No redesign of the tables/forms themselves — same columns, same dialogs.
- No change to what each area manages or to permissions (still `COMPANY_VIEW` to view,
  `COMPANY_MANAGE`/`DEPARTMENT_MANAGE`/etc. for actions exactly as today).
- No new generic "tabs vs sidebar" framework — this is a targeted split of one screen.

## Decisions

1. **Four sibling views under `views/admin/org/`.** `CompaniesView.vue`, `DepartmentsView.vue`,
   `FiscalYearsView.vue`, `HolidaysView.vue`. Each owns only its table + dialog + handlers, lifted
   verbatim from the corresponding `<TabPanel>` and the script slices that feed it, and calls only its
   own store loader in `onMounted`. The departments view keeps the tree-building + `visibleDepartments`
   filter + parent-cycle exclusion logic unchanged. Each gets its own `<PageHeader :title>` (the title
   that was the tab label).

2. **Shared helpers extracted to `views/admin/org/orgForm.ts`.** `toYmd` (local-date → `YYYY-MM-DD`,
   no UTC shift) and `fieldErrors` (first Zod issue per top-level field) are used by both the fiscal
   and holiday dialogs; extract them so the two views don't copy-paste and drift. Company/department
   dialogs likewise import what they need. Pure functions, no state.

3. **A new `organization` NAV section, four entries.** Add `"organization"` to `NAV_SECTIONS`
   (positioned after `administration`, matching the chosen grouping) and four `NAV` entries
   (`orgCompanies`, `orgDepartments`, `orgFiscalYears`, `orgHolidays`), each `permission:
   'COMPANY_VIEW'`, `section: 'organization'`, with distinct PrimeIcons. Remove the old single
   `organization` entry. `groupNav` then renders the section iff the user holds `COMPANY_VIEW`
   (empty sections are already dropped), so visibility is unchanged.

4. **Routes: four children + a redirect.** Under the `AppLayout` children: `org-admin/companies`,
   `org-admin/departments`, `org-admin/fiscal-years`, `org-admin/holidays`, each
   `meta: { permission: 'COMPANY_VIEW' }`. Replace the old `org-admin` route with
   `{ path: 'org-admin', redirect: { name: 'org-companies' } }`. Drop the `OrgAdminView` import and
   delete the file.

5. **i18n.** Add `nav.sections.organization` and the four `nav.org*` labels to `en` + `la` (parity
   test enforces both). Reuse existing `admin.org.*` strings for in-page content; the per-tab titles
   become the page titles via the existing `admin.org.tabs.*` keys (or promote them to
   `admin.org.pages.*` for clarity — either way both locales stay key-complete).

## Risks / Trade-offs

- **Cross-page store state.** The shared `useOrgStore` keeps each slice; navigating between pages
  re-runs that page's loader in `onMounted`, which is the same refresh behaviour tabs had on first
  open. Departments view also needs the company list for some labels/selects — it loads what it uses,
  as the tab did. Low risk; no shared-state coupling beyond the store that already existed.
- **Behaviour drift during extraction.** The main risk of any split is subtly changing a handler.
  Mitigation: lift code verbatim, keep the shared-Zod validation and the parent-cycle guard intact,
  and verify with `vue-tsc` + the existing org-admin specs; manually confirm each page's create/edit
  still validates and scopes.
- **Sidebar length.** A new section adds four entries; grouping them under their own header (the
  chosen option) keeps Administration uncluttered and the group collapsible.
