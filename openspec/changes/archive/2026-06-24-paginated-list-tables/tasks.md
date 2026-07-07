## 1. Backend — shared pagination

- [x] 1.1 Add a shared `PaginationQueryDto { page?: number; limit?: number }` (class-validator: ints ≥ 1; default `page=1`, `limit=20`; clamp `limit` to a max, e.g. 100) and a `Paginated<T> = { items: T[]; total: number; page: number; limit: number }` type, in a common location (e.g. `back/src/common/pagination/`).
- [x] 1.2 Add a helper `paginate(em/qb or findAndCount args, { page, limit })` that runs a single count+slice (`offset`/`limit`) and returns the envelope — scope/filters are applied by the caller before paging.

## 2. Backend — paginate every list endpoint (scope/filter first, then page)

- [x] 2.1 Budgets: `GET /budgets` → paginated. (Budget **ledger** sub-table in the detail page left on its existing display — bounded per-budget, running-balance/doc-no post-processed; documented follow-up.)
- [x] 2.2 Documents: `GET /documents` → paginated.
- [x] 2.3 Approvals: pending inbox list → paginated.
- [x] 2.4 Quota: quota list + usage list → paginated.
- [x] 2.5 Master data: vendors + items lists → paginated.
- [x] 2.6 RBAC: users/assignments lists → paginated.
- [x] 2.7 Notifications: inbox list → paginated.
- [x] 2.8 Multi-company (org): companies, departments, fiscal years, holidays lists → paginated.
- [x] 2.9 Currency: currencies + exchange-rate lists → paginated.
- [x] 2.10 Doc-config / approval-config: document types, templates, dept-doc-type, workflows/steps, delegations lists → paginated.
- [x] 2.11 Keep company scope (invariant 1) and existing filters applied before the page window; `total` reflects the scoped/filtered set.

## 3. Frontend — shared infra

- [x] 3.1 Add `dayjs` dependency (+ `dayjs/locale/lo`); add `src/utils/date.ts` exporting `formatDate(date)` → `dddd DD-MM-YYYY` for the active locale (Lao configured).
- [x] 3.2 Add `src/components/AppDataTable.vue` wrapping PrimeVue `DataTable`: props `value`, `total`, `loading`, `rows`(=limit), `scrollHeight` (default `'500px'`); `lazy` + `paginator` + `scrollable`; `#loading` ProgressSpinner; `#paginatorstart` refresh button (`pi pi-spin pi-refresh` while loading) emitting `refresh`; leading `#` row-number `Column`; emits `page` (`{ page, limit }`) on paginator change; default slot for caller columns. No `#paginatorend` download button.
- [x] 3.3 Add i18n (en + la) for any new table chrome labels (e.g. refresh tooltip, rows-per-page) used by `AppDataTable`.

## 4. Frontend — list stores hold a paged window

- [x] 4.1 For each list store, change state to `{ items, total, page, limit, loading, error }` and make `loadList(page=1, limit=20)` send the params and store the envelope. Keep the inline `error` (page-load) path for `ErrorState`.
- [x] 4.2 Update the typed API clients to send `page`/`limit` and parse `{ items, total, page, limit }`.

## 5. Frontend — views adopt AppDataTable + localized dates

- [x] 5.1 Replace the raw `DataTable` + `TableSkeleton` in each of the 13 list views with `<AppDataTable>`, binding `:value`, `:total`, `:loading`, `:rows`, and handling `@page` / `@refresh` → store `loadList(page, limit)`.
- [x] 5.2 Render date columns through `formatDate` (replace raw ISO/`createdAt`/date fields).
- [x] 5.3 Preserve each view's existing columns, permission-gated actions, empty state, and the page-load `ErrorState`. (Detail sub-tables: quota **usage** paginated; quota **entitlements** + budget **ledger** left on existing display — bounded embedded arrays.)

## 6. Tests & verify

- [x] 6.1 Backend: a unit/integration test that a paginated list honors `page`/`limit`, returns the correct `total`, clamps an over-max `limit`, and applies company scope before paging.
- [x] 6.2 Frontend: a component test for `AppDataTable` (renders rows + `#` column, emits `page` on paginator change, shows the spinner while `loading`).
- [x] 6.3 `npx vue-tsc -b` and backend `nest build` clean (no new errors); `pnpm test` (front) + budget/document/etc. vitest (back) green.
- [x] 6.4 Manual: a list scrolls at 500px, pages via the server, refresh re-requests the page, and dates show in Lao format — light and dark mode.
