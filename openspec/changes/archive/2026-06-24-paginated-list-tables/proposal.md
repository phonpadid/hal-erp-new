## Why

List screens render the entire result set in a non-scrolling table with no paging — fine
for seed data, but it will not hold up as documents, ledgers, notifications, and master
data grow. There is no shared table component, so the 13 list views each re-wire a raw
`DataTable` + `TableSkeleton`, and dates render as raw ISO strings. We want every list to be
server-paginated (the client sends `page`/`limit`), scrollable with a fixed height, and to
share one table component with a consistent loading/refresh affordance and localized dates.

## What Changes

- **BREAKING — server-paginated list endpoints.** Every list (`GET` returning an array)
  accepts `page` and `limit` query params and returns `{ items, total, page, limit }`
  instead of a bare array. Company scope + existing filters apply first, then the page
  window (`findAndCount` with `offset`/`limit`). A default `limit` and a hard max cap apply.
- **Shared `AppDataTable` component (frontend).** A wrapper over PrimeVue `DataTable` in
  **lazy** mode: `scrollable` with `scrollHeight="500px"` (overridable), `paginator` bound to
  the server's `total`, a `#loading` `ProgressSpinner`, a `#paginatorstart` refresh button
  (spinning icon while loading), and a leading `#` row-number column. It emits page changes
  (`{ page, limit }`) and `refresh`; callers pass column definitions via the default slot.
  (The `#paginatorend` download button is intentionally omitted for now.)
- **Stores + views.** List stores hold `items` + `total` + `page` + `limit` and fetch with
  those params; the 13 list views adopt `AppDataTable` and reload on page/refresh.
- **Localized dates.** Add `dayjs` (+ Lao locale) and a shared `formatDate` helper
  (`dddd DD-MM-YYYY`, active locale); date columns render through it.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `platform-foundation`: add that list endpoints are server-paginated (`page`/`limit` →
  `{ items, total, page, limit }`), scoped/filtered before paging, with a default + max limit.
- `web-app-layout`: add a shared scrollable, server-paginated data-table component (fixed
  scroll height, lazy paging, loading spinner, in-paginator refresh, row-number column).
- `web-i18n`: the locale-aware date formatting is provided by a shared `formatDate` helper
  (dayjs, active locale incl. Lao).

## Impact

- Backend: a shared `PaginationQuery` DTO + `Paginated<T>` shape + a paging helper; every
  list service/controller across budgets, documents, approvals, quota, master-data, rbac,
  notifications, multi-company (org), currency, doc-config, approval-config (~15 endpoints).
- Frontend: new `AppDataTable.vue` + `src/utils/date.ts`; `dayjs` dependency; updates to the
  list stores and the 13 list views. i18n labels (en/la) for table chrome.
- **Breaking**: list response shape changes — every consuming store updates in lockstep.
  Detail/single-record endpoints are unaffected. No DB/migration change.
