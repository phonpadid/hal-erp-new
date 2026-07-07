## 1. Backend — query DTO

- [x] 1.1 Add `DocumentListQueryDto extends PaginationQueryDto` in the document module with optional
  validated fields: `status?: DocStatus[]` (`@IsEnum(DocStatus, { each: true })`, transform a
  comma-separated string into an array), `documentTypeId?` / `departmentId?` / `vendorId?`
  (`@IsUUID`), `createdFrom?` / `createdTo?` (`@IsDateString`), `docNo?` (`@IsString`, trimmed,
  length-capped), `minAmount?` / `maxAmount?` (`@IsString` + decimal-pattern, **not** `@IsNumber`).

## 2. Backend — list service

- [x] 2.1 Change `DocumentService.list` to accept `DocumentListQueryDto` and build a `where` object
  from the present filters: `status → $in`, type/department/vendor → equality, `createdAt → $gte/$lte`
  (`createdTo` end-of-day inclusive), `docNo → $ilike %term%`, `baseTotalAmount → $gte/$lte` with the
  bounds passed as strings (no JS-number coercion).
- [x] 2.2 Pass the built `where` into `paginate(...)` on the `forActiveCompany()` EM so the company
  filter stays auto-applied; add `orderBy: { createdAt: 'DESC' }` for stable paging.
- [x] 2.3 Update `document.controller.ts` list handler to bind `@Query() DocumentListQueryDto`.

## 3. Backend — tests

- [x] 3.1 Unit/e2e: filter by `status` returns only matching docs; combined type + date-range filters
  AND together; `createdTo` boundary is inclusive of the end day.
- [x] 3.2 Amount-range test asserting decimal-string comparison works for a value beyond
  `Number.MAX_SAFE_INTEGER` (no JS-number coercion).
- [x] 3.3 Isolation test: a `documentTypeId`/`vendorId` from another company returns an empty result
  and never another company's document.
- [x] 3.4 Validation test: a non-UUID `documentTypeId` and a non-decimal `minAmount` are rejected
  before the handler runs; no-filter request matches pre-change behavior.

## 4. Frontend — API + store

- [x] 4.1 Extend `documentsApi.list` and `DocumentSummary`/query types in `api/documents.ts` to accept
  and serialize the filter params (status array, type, department, date range, docNo, min/max amount
  as strings, vendor).
- [x] 4.2 Update `stores/documents.ts` `loadList` to hold the active filters, send them, and reset to
  page 1 when filters change.

## 5. Frontend — filter bar UI

- [x] 5.1 Add a filter bar to `MyDocumentsView.vue`: status multiselect, type select, department
  select, created-date range picker, debounced doc-no search, and min/max amount text inputs (kept as
  strings). Replace the client-only global search with the server doc-no search.
- [x] 5.2 Add a clear-filters control that requeries with no params.
- [x] 5.3 Add filter labels to the `en` and `la` common/documents i18n catalogs (key-complete).

## 6. Frontend — tests

- [x] 6.1 Test that changing a filter calls `loadList` with the expected params and resets to page 1.
- [x] 6.2 Test that amount inputs are sent as strings and never converted to a JS number.
