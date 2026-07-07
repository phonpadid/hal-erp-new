## Why

The Configuration → Document Types page (`/doc-config/types`, `DocTypesView`) only offers a
global text search over `code`/`name`. As a company accumulates many document types across
several categories and flag combinations, an admin cannot narrow the list to, say, only the
active types that require a budget. Structured filters make the list usable at scale.

## What Changes

- Add page-specific filters to the Document Types list, exposed in the toolbar `#filters` slot
  alongside the existing global search:
  - **Category** — Select over `DOC_CATEGORIES`, clearable, single-select.
  - **Active status** — Select (Active / Inactive), clearable.
  - **Requirement flags** — clearable filter for `requires_budget` / `requires_quota` /
    `requires_vendor` (multi-select of flags a type must have).
- Filters combine with the global search (AND) and with each other; clearing a filter restores
  the broader list. An empty/cleared filter means "no constraint".
- Show a cleared/empty result via the existing `EmptyState`, and surface how many filters are
  active so the user can reset them.
- This is a client-side, in-memory filter over the already-loaded `documentTypes` list
  (the Configuration area loads all types once); no new API, DTO, or backend query is added.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-doc-config`: the **Document Type Management** requirement gains behavior for filtering
  the document-type list by category, active state, and requirement flags (in addition to the
  existing global search).

## Impact

- **Code:** `front-end/src/views/admin/doc-config/DocTypesView.vue` (filter state + `#filters`
  slot markup + filtered list). Reuses `PageToolbar`'s `#filters` slot, PrimeVue `Select`, and
  `FilterMatchMode` conventions already used elsewhere (e.g. `QuotaAdminView`, `EmployeeAdminView`).
- **i18n:** new keys under `admin.docConfig.filters.*` for the filter placeholders/labels.
- **No backend, DBML, or shared-schema change.** Company scope and the `DOC_CONFIG_MANAGE`
  permission guard are unchanged; filtering only narrows an already company-scoped, already
  permission-gated list, so no core invariant is affected.
