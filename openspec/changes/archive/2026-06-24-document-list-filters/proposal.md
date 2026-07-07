## Why

The `/documents` list is server-paginated but the list endpoint accepts only `page`/`limit` —
there is no server-side filtering. The web app's current search box is a PrimeVue client filter,
so it only narrows the 20 rows already loaded on the current page, not the whole dataset. Users
with many documents cannot reliably find one by status, type, date, or amount. This change adds
real, server-backed filtering to the document list, end to end.

## What Changes

- **Backend (`document-engine`):** extend the `GET /documents` list endpoint to accept optional
  filter query parameters and apply them as a `where` clause **after** the company scope, inside
  the existing pagination. Filters:
  - `status` — one or more `doc_status` values (multi-select)
  - `documentTypeId` — by `document_type_id`
  - `departmentId` — by `department_id` (only honored within the caller's permission scope; an
    OWN/DEPARTMENT-scoped caller cannot widen visibility through this filter)
  - `createdFrom` / `createdTo` — `created_at` date range
  - `docNo` — case-insensitive contains match on `doc_no`
  - `minAmount` / `maxAmount` — range on `base_total_amount` (decimal strings, company base currency)
  - `vendorId` — by `vendor_id`
- **Frontend (`web-documents`):** add a filter bar to the documents list that sends these as query
  params and resets to page 1 on change. Replace the misleading client-only search with the
  server-side `docNo` search. Status and type are select inputs sourced from known values; amounts
  are formatted/handled as strings, never JS numbers.
- The filter set is applied conjunctively (AND); omitted params mean "no constraint".

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `document-engine`: add a **Filtered Document Listing** requirement — the company-scoped list
  endpoint accepts optional filters applied within the existing scope and pagination, and filtering
  never widens visibility beyond the caller's company and permission scope.
- `web-documents`: extend the **Document List and Detail** behavior with a documents filter bar that
  drives server-side filtering (status, type, department, date range, doc-no search, amount range,
  vendor) and replaces the client-only search.

## Impact

- Backend: `back/src/modules/document/document.controller.ts` (list query DTO),
  `document.service.ts` (`list` builds a `where` from filters; reuses `paginate`). A new
  `DocumentListQueryDto` extends `PaginationQueryDto`.
- Frontend: `front-end/src/views/documents/MyDocumentsView.vue` (filter bar),
  `front-end/src/api/documents.ts` + `stores/documents.ts` (pass filter params),
  i18n catalogs for the new filter labels (`en` + `la`, key-complete).
- Invariants upheld: **company isolation** (filters apply only after the active-company scope; a
  cross-company `documentTypeId`/`vendorId`/`departmentId` simply matches nothing, never leaks);
  **permission scope** (the `departmentId` filter cannot broaden an OWN/DEPARTMENT-scoped read);
  **money is never a JS number** (amount bounds are decimal strings end to end). No change to
  ledgers, numbering, FX, or write paths.
- No DBML change: all filtered columns already exist on `document`, and
  `(company_id, department_id, status)` already indexes the common status/department filters.
