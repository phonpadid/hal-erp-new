## Why

The Organization admin screen (`/org-admin`) packs four distinct management areas — Companies,
Departments, Fiscal years, Holidays — behind PrimeVue tabs in a single 450-line view. Tabs hide three
of the four areas behind a click, aren't directly linkable/bookmarkable, and make the view a
catch-all that's hard to navigate and extend. The rest of the app already navigates by sidebar, one
page per concern. This change brings Organization in line: each area becomes its own routed page,
reached from a dedicated **Organization** group in the sidebar, instead of tabs.

## What Changes

- The four tab panels become four routed views:
  - `/org-admin/companies` — company list + create/edit dialog
  - `/org-admin/departments` — department tree + create/edit dialog (parent-cycle guard kept)
  - `/org-admin/fiscal-years` — fiscal year list + create dialog
  - `/org-admin/holidays` — holiday calendar + create dialog
- A new **Organization** sidebar section groups these four entries, each gated by `COMPANY_VIEW`
  (the existing org-admin permission), mirroring the section→items model the sidebar already uses.
- `/org-admin` **redirects** to `/org-admin/companies` so existing links/bookmarks keep working; the
  tabbed `OrgAdminView` is removed.
- Each page keeps its current behaviour verbatim — same tables, dialogs, validation against the
  shared Zod schemas, permission-gated actions, company scoping, and the department parent-cycle UX
  guard. Only the navigation shell changes (tabs → sidebar pages); no data, API, or business logic
  changes.
- Shared helpers used by more than one page (e.g. local-date→`YYYY-MM-DD`, per-field Zod issue
  mapping) move to a small reusable module so each split view stays lean and they don't drift.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-org-admin`: the four management areas are presented as separate sidebar-navigated pages rather
  than tabs within one screen; the navigation/permission requirement is restated in terms of a
  sidebar Organization group + per-area routes (no change to what each area does).

## Impact

- Frontend only:
  - New views under `front-end/src/views/admin/org/`: `CompaniesView.vue`, `DepartmentsView.vue`,
    `FiscalYearsView.vue`, `HolidaysView.vue` (extracted from `OrgAdminView.vue`).
  - `front-end/src/router/index.ts`: four child routes + a `/org-admin` → companies redirect; remove
    the single `org-admin` route/`OrgAdminView` import.
  - `front-end/src/layouts/store/layout.store.ts`: add an `organization` nav section + four NAV
    entries (replacing the single `organization` entry).
  - `front-end/src/i18n/locales/{en,la}`: `nav.sections.organization` + the four page labels; reuse
    existing `admin.org.*` strings for in-page content.
  - A small shared util (e.g. `front-end/src/views/admin/org/orgForm.ts`) for the cross-page helpers.
  - `OrgAdminView.vue` deleted.
- No backend, DTO, schema, or migration changes. No change to the `org` Pinia store's data or API.
