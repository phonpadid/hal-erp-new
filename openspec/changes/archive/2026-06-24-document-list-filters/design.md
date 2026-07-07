## Context

`GET /documents` → `DocumentService.list(q)` currently calls
`paginate(this.scope.forActiveCompany(), Document, {}, {}, q)` — an empty `where`, so the only
constraint is the always-on `company` filter bound by `forActiveCompany()`. `PaginationQueryDto`
carries just `page`/`limit`. The web list ([MyDocumentsView.vue]) wires a PrimeVue global filter,
which only narrows the rows already fetched for the current page — not the full set. We need real
filtering pushed to the server.

All target columns already exist on `document` (`status`, `document_type_id`, `department_id`,
`created_at`, `doc_no`, `base_total_amount`, `vendor_id`), and `(company_id, department_id, status)`
is already indexed.

## Goals / Non-Goals

**Goals:**
- Optional, conjunctive (AND) server-side filters on the company-scoped list, inside the existing
  pagination.
- Filtering can only narrow within the active company — never widen or cross the isolation boundary.
- Money bounds handled as decimal strings end to end; never coerced to a JS number.

**Non-Goals:**
- No saved/named filters, no full-text search across field values, no sorting UI (a deterministic
  default order is added, but column-sort controls are out of scope).
- No DBML/migration change; no new index in this slice (call out if `doc_no` ILIKE needs a trigram
  index later).
- No change to detail, create, submit, or any write path.

## Decisions

**1. `DocumentListQueryDto extends PaginationQueryDto`.** Add optional, validated fields:
- `status?: DocStatus[]` — `@IsEnum(DocStatus, { each: true })`; accept repeated `?status=` or a
  comma-separated value (a transform splits a string into an array).
- `documentTypeId?`, `departmentId?`, `vendorId?` — `@IsUUID()`.
- `createdFrom?`, `createdTo?` — `@IsDateString()`.
- `docNo?` — `@IsString()`, trimmed, length-capped.
- `minAmount?`, `maxAmount?` — `@IsString()` matched against a decimal regex
  (`/^\d+(\.\d+)?$/`). **Not** `@IsNumber` — money stays a string (invariant 6: money is never a
  JS number, on either side of the wire).

Validation rejects malformed input with 422 before the handler runs.

**2. `list` builds a `where` from the DTO and passes it to `paginate`.** The company filter remains
auto-applied; the built `where` is pure narrowing:
- `status` → `{ status: { $in: status } }`
- `documentTypeId` / `departmentId` / `vendorId` → equality
- `createdFrom`/`createdTo` → `{ createdAt: { $gte, $lte } }` (`createdTo` is treated as
  end-of-day inclusive)
- `docNo` → `{ docNo: { $ilike: `%${docNo}%` } }`
- `minAmount`/`maxAmount` → `{ baseTotalAmount: { $gte, $lte } }`, passed as **strings**; Postgres
  compares them numerically against the `decimal(15,2)` column with no JS-number round-trip.

A deterministic default order (`orderBy: { createdAt: 'DESC' }`) is added so paging is stable.

**3. Isolation is structural, not per-filter.** Because `forActiveCompany()` binds the `company`
filter on every query, a `documentTypeId`/`vendorId`/`departmentId` that belongs to another company
simply matches zero rows — it can never leak or widen. No extra cross-company guard is needed beyond
keeping the filters as `where` conditions on the scoped EM. The list read is company-scoped for
`DOC_VIEW` (unchanged); the `departmentId` filter is a narrowing convenience within that scope.

**4. Frontend filter bar drives the query.** `MyDocumentsView` holds a reactive filter object;
changing any filter resets to page 1 and calls `docs.loadList(...)` with the params threaded through
`documentsApi.list`. Status/type use PrimeVue `Select`/multiselect from known values; dates use a
range `DatePicker`; `docNo` is a debounced text input replacing the old client search; amount
min/max are text inputs kept as strings. Labels come from the i18n catalogs (`en` + `la`,
key-complete).
- *Alternative considered:* keep the client-side global filter — rejected because it only filters the
  current page and is misleading at scale.

## Risks / Trade-offs

- [`doc_no` ILIKE `%term%` can't use the btree index] → Acceptable at current scale; if it becomes
  hot, add a `pg_trgm` GIN index on `doc_no` in a later slice. Noted, not silently ignored.
- [Amount parsed as a number somewhere on the way to the query] → Validate as a decimal string and
  pass the raw string into the `where`; a unit test asserts a value beyond `Number.MAX_SAFE_INTEGER`
  filters correctly.
- [Client/server filter drift] → Mirror the query DTO with one front-end filter type; both reference
  the same `DocStatus` values.
- [`createdTo` off-by-one (excludes the end day)] → Normalize `createdTo` to end-of-day inclusive and
  cover it with a boundary test.

## Migration Plan

Purely additive and backward-compatible: with no filter params the endpoint behaves exactly as
today. No data migration, no flag. Rollback is reverting the DTO/service/UI changes.

## Open Questions

None. This is a read-only path: it writes neither `budget_txn` nor `quota_usage`, so no
`em.transactional()` boundary and no pessimistic locking apply.
