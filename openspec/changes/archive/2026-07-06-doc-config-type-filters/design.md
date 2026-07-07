## Context

`DocTypesView.vue` renders the Configuration → Document Types list from
`useDocConfigStore().documentTypes`, which the Configuration area loads once (all types for the
active company). The view already wires PrimeVue DataTable's global filter to the `PageToolbar`
search field (`typeFilters.global`, matching `code`/`name`). There is no way to narrow by
category, active state, or the requirement flags shown in the table. Sibling views
(`QuotaAdminView`, `EmployeeAdminView`) already establish the pattern for page-specific filters
via the toolbar `#filters` slot with clearable `Select`s.

This is a purely client-side, presentation-layer change. No `budget_txn`, `quota_usage`, or any
ledger is touched; no API, DTO, or DB query is added; there is no transaction boundary or lock to
consider. Company scope and the `DOC_CONFIG_MANAGE` guard are unchanged — filtering only hides
rows from an already-scoped, already-permission-gated list.

## Goals / Non-Goals

**Goals:**
- Add clearable Category, Active-state, and requirement-flag filters to the Document Types list.
- Keep the existing global search working; filters and search combine with AND semantics.
- Reuse existing conventions: `PageToolbar` `#filters` slot, PrimeVue `Select`, PrimeUI theme
  tokens, i18n keys, and the `EmptyState` for a no-match result.

**Non-Goals:**
- No server-side filtering, new endpoint, query param, or pagination change.
- No change to create/edit dialogs, the store, the shared schema, or the DBML.
- No new saved-filter/persistence behavior (filters reset on navigation away).

## Decisions

- **Filter surface.** Render three controls in `PageToolbar`'s `#filters` slot:
  - `categoryFilter` — `Select` over `opt(DOC_CATEGORIES)`, `showClear`, single value (`null` = all).
  - `activeFilter` — `Select` with `{ Active: true, Inactive: false }` options, `showClear`.
  - `flagFilter` — `MultiSelect` over `budget` / `quota` / `vendor`; a row must have **every**
    selected flag set (AND across selected flags). `showClear`, empty = no constraint.
- **Combine mechanism.** Keep the existing DataTable global-search filter for `code`/`name`
  (untouched), and apply the three structured filters by feeding the DataTable a
  `computed` `filteredTypes` derived from `cfg.documentTypes`:
  ```
  filteredTypes = documentTypes.filter(t =>
    (categoryFilter == null || t.category === categoryFilter) &&
    (activeFilter   == null || t.isActive === activeFilter) &&
    selectedFlags.every(f => t[flagField(f)] === true))
  ```
  DataTable then applies the global text search on top, so search AND structured filters compose
  without re-implementing text matching. (Alternative — pushing everything through
  DataTable column filters with `FilterMatchMode.EQUALS` — was rejected because the flag AND-set
  and the boolean active toggle are simpler and clearer as an explicit computed.)
- **Reset affordance.** Track an `activeFilterCount` computed; when > 0 show a small "clear
  filters" button (mirrors the badge idea in `MyDocumentsView`). Clearing resets all three refs
  to their empty value; the global search is cleared independently via the existing field.
- **Empty result.** No structural change needed — when the computed list plus search yield no
  rows, the DataTable `#empty` slot already renders `EmptyState`.
- **i18n.** Add `admin.docConfig.filters.category`, `.status`, `.active`, `.inactive`, `.flags`,
  and `.clear` keys, using existing flag labels under `admin.docConfig.flags.*`.

## Risks / Trade-offs

- **In-memory only.** Correct here because the Configuration area already loads the full,
  company-scoped type list; if that ever becomes paginated/server-fetched, these filters would
  need to move server-side. Documented as a non-goal for now.
- **Two filtering layers** (computed for structured filters, DataTable for global search) is
  slightly less uniform than doing everything in one place, but it avoids re-implementing global
  text matching and keeps each layer trivial to test.
- **Component test coverage.** `DocTypesView` should get a spec asserting each filter narrows the
  rendered rows and that filters + search compose; this is the main new test surface.
