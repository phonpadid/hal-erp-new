## ADDED Requirements

### Requirement: Filtered Document Listing

The document list endpoint SHALL accept optional filter parameters and apply them as additional
`where` conditions within the active-company scope and the existing pagination. The supported
filters are: `status` (one or more `doc_status` values), `documentTypeId` (`document_type_id`),
`departmentId` (`department_id`), `createdFrom`/`createdTo` (a `created_at` date range,
`createdTo` inclusive of the end day), `docNo` (case-insensitive contains match on `doc_no`),
`minAmount`/`maxAmount` (an inclusive range on `base_total_amount`), and `vendorId` (`vendor_id`).
Filters SHALL combine conjunctively; an omitted filter imposes no constraint. Amount bounds SHALL
be carried and compared as decimal strings and SHALL NOT be coerced to a JavaScript number.
Filtering SHALL only narrow results within the caller's active company — it SHALL NOT widen
visibility or return any `document` outside the active company, and a filter value that belongs to
another company SHALL match no rows rather than leak data. Filter inputs SHALL be validated
(enum membership, UUID format, date format, and a decimal pattern for amounts) and a malformed
value SHALL be rejected before the handler runs. The endpoint SHALL remain gated by `DOC_VIEW`.

#### Scenario: Filter by status returns only matching documents

- **WHEN** a `DOC_VIEW` user lists documents with `status=SUBMITTED`
- **THEN** only the active company's documents whose `status` is `SUBMITTED` are returned, within
  the normal page window

#### Scenario: Filters combine conjunctively

- **WHEN** the list is requested with both a `documentTypeId` and a `created_at` range
- **THEN** only documents matching that type AND falling within that date range are returned

#### Scenario: Amount range filters on the decimal string

- **WHEN** the list is requested with `minAmount` and `maxAmount`
- **THEN** only documents whose `base_total_amount` falls inclusively within the range are returned,
  compared as decimal values without coercing the amount to a JavaScript number

#### Scenario: A cross-company filter value leaks nothing

- **WHEN** a user filters by a `documentTypeId` or `vendorId` that exists only in another company
- **THEN** the result is empty and no document from another company is returned

#### Scenario: Malformed filter input is rejected

- **WHEN** the list is requested with an invalid filter value (e.g. a non-UUID `documentTypeId` or a
  non-decimal `minAmount`)
- **THEN** the request is rejected with a validation error before the list handler runs

#### Scenario: No filters preserves existing behavior

- **WHEN** the list is requested with only `page`/`limit` and no filters
- **THEN** the active company's documents are returned exactly as before this change
