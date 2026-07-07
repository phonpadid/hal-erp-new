## 1. Filter state and logic

- [x] 1.1 In `DocTypesView.vue`, add refs for the three filters: `categoryFilter` (string | null), `activeFilter` (boolean | null), `flagFilter` (string[] — subset of `budget`/`quota`/`vendor`).
- [x] 1.2 Add a `filteredTypes` computed over `cfg.documentTypes` applying category equality, active-state equality, and the AND-set flag check (each selected flag must be true on the row); empty/null values impose no constraint.
- [x] 1.3 Add an `activeFilterCount` computed and a `clearFilters()` that resets the three refs.
- [x] 1.4 Bind the DataTable `:value` to `filteredTypes` (keeping the existing `typeFilters` global search on `code`/`name`), so structured filters and search compose with AND.

## 2. Filter UI (toolbar `#filters` slot)

- [x] 2.1 Add a `Select` (category) over `opt(DOC_CATEGORIES)` with `showClear`, bound to `categoryFilter`.
- [x] 2.2 Add a `Select` (active state) with Active/Inactive options and `showClear`, bound to `activeFilter`.
- [x] 2.3 Add a `MultiSelect` (requirement flags: budget/quota/vendor) with `showClear`, bound to `flagFilter`, using existing `admin.docConfig.flags.*` labels.
- [x] 2.4 Show a "clear filters" button when `activeFilterCount > 0`, calling `clearFilters()`.
- [x] 2.5 Style controls with PrimeUI tokens/utility classes only (no hardcoded colors); confirm light and dark render.

## 3. i18n

- [x] 3.1 Add `admin.docConfig.filters.{category,status,active,inactive,flags,clear}` keys to every locale file the app ships.

## 4. Tests

- [x] 4.1 Add/extend a `DocTypesView.spec.ts` covering: filter by category, by active state, by flag (AND set), filters + global search compose, and the empty-state when nothing matches.
- [x] 4.2 Run the frontend unit suite and smoke test (`views.smoke.spec.ts`) to confirm the view still mounts.
