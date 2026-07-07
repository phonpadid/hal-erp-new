## Context

13 list views each re-wire a raw PrimeVue `DataTable` + `TableSkeleton` over a store array;
no list endpoint pages on the server (all return bare arrays), and dates render as raw ISO.
The user wants every table scrollable (fixed height), server-paginated (client sends
`page`/`limit`), unified into one component, with localized (Lao) dates. `dayjs` is not yet a
dependency. Decisions: **every** list endpoint is server-paginated (response shape changes to
`{ items, total, page, limit }` — breaking), and the paginator's download button is dropped.

## Goals / Non-Goals

**Goals**
- One shared `AppDataTable` used by all list pages; server-driven (lazy) paging; 500px scroll.
- A uniform backend paging contract applied with company scope/filters first.
- A single `formatDate` helper for localized dates.

**Non-Goals**
- No change to single-record (detail) endpoints or their views.
- No client-side paging of server-paginated lists; no infinite scroll.
- No DB/migration change; no new permissions.

## Decisions

**Decision: uniform backend contract `{ items, total, page, limit }` via `findAndCount`.**
A shared `PaginationQueryDto` (page≥1 default 1; limit default 20, clamped to a max) and a
`paginate` helper wrap `em.findAndCount(Entity, where, { offset: (page-1)*limit, limit })`.
Callers build `where` with company scope + filters first, so `total` is the scoped count.
- *Alternative — keep arrays, page only on the client*: rejected; the user asked for server
  paging, and it doesn't scale for documents/ledgers/notifications.

**Decision: lazy-mode `AppDataTable` wrapper, server is the source of truth.**
Props: `value` (current page rows), `total`, `loading`, `rows` (=limit), `scrollHeight`
(default `'500px'`). Sets PrimeVue `lazy`, `paginator`, `:totalRecords="total"`, `scrollable`.
Slots/templates: `#loading` → `ProgressSpinner`; `#paginatorstart` → refresh button
(`pi pi-spin pi-refresh` while `loading`) emitting `refresh`; a built-in leading `#`
row-number `Column` (numbered by page offset: `(page-1)*limit + index + 1`); default slot for
the caller's `<Column>`s. Emits `page` with `{ page, limit }` on `@page`. No `#paginatorend`.
- *Alternative — global DataTable config / mixin*: rejected; an explicit wrapper keeps the
  lazy contract and the row-number/refresh chrome in one reviewable place.

**Decision: paged store shape; views stay thin.**
Each list store holds `{ items, total, page, limit, loading, error }`; `loadList(page, limit)`
calls the API with params and stores the envelope. Views bind `:value="store.items"`,
`:total="store.total"`, `:loading`, `:rows="store.limit"`, and on `@page`/`@refresh` call
`loadList(...)`. The page-load `error` → `ErrorState` path is unchanged.

**Decision: `formatDate` via dayjs + Lao locale.**
`src/utils/date.ts` imports `dayjs` + `dayjs/locale/lo`, sets the locale, and exports
`formatDate(date) => dayjs(date).format('dddd DD-MM-YYYY')`. Date columns call it. This is the
single date helper the web-i18n requirement now mandates.

## Risks / Trade-offs

- [Breaking response shape across ~15 endpoints + 11 stores] → land backend + its store/API
  client together per area; the area's list view is the integration point. Migrate area by
  area (budgets → documents → …) so the app keeps building between areas.
- [Client-side global search/filter no longer sees the whole set] → with server paging, the
  existing `globalFilter` only filters the current page. Search should move server-side
  eventually; for now keep the toolbar search filtering the current page and note the limit
  (out of scope to make every list's search server-side in this change).
- [Row numbering across pages] → number by server offset, not the in-page index, so page 2
  starts at limit+1.
- [dayjs locale bundle size] → only the `lo` locale is imported; negligible.

## Migration Plan

Frontend dependency add (`dayjs`) + new component/util; backend shared pagination util; then
area-by-area endpoint+store+view migration. No DB migration. Rollback per area is independent.

## Open Questions

- Should list **search/filter** become server-side in this change, or stay client-side on the
  current page for now? (Default: client-side on the current page; server-side search is a
  follow-up.)
