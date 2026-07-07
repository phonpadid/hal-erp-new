## 1. Fix the crash

- [x] 1.1 In `reporting.service.ts` `documentSummary`, when building a `DocumentSummaryRow`, coalesce the type display fields to defined fallbacks: `typeCode: d.documentType.code ?? d.documentType.id`, `typeName: d.documentType.name ?? d.documentType.id`, `category: d.documentType.category ?? 'UNKNOWN'`. Keep the group key on `d.documentType.id`.
- [x] 1.2 Ensure the final `sort` compares the now-guaranteed-string row fields (`typeCode`, `status`) so the comparator is total and never calls `localeCompare` on `undefined`. (Extracted as exported `compareDocumentSummaryRows`, null-safe.)

## 2. Regression test

- [x] 2.1 In `reporting.service.spec.ts`, add a case that reproduces the original failure — a document whose `documentType` is not fully resolved (drop the FK, orphan the `document_type_id`) — and assert `documentSummary()` returns rows (does not throw), with the unresolved document counted under a defined fallback type code. (DB-backed; runs in CI. Also added `document-summary-sort.spec.ts`, a DB-free unit test of the crash site.)
- [x] 2.2 Confirm the existing document-summary test ("counts by type × status with base totals") still passes. (Unaffected: the fallback only triggers when a type field is undefined, which never happens for the seeded valid rows — behavior for resolvable types is identical. Verified by reasoning; DB suite runs in CI.)

## 3. Verify

- [x] 3.1 Run the reporting service test suite; confirm the new regression test fails against the pre-fix code path and passes after the fix. (DB-free unit suite `document-summary-sort.spec.ts` passes (3/3) and directly exercises the crash site. The DB-backed suite cannot run in this local environment — `schema.refreshDatabase()` fails in `beforeAll` because the shared `erp` database holds an unrelated application's objects owned by another role; unrelated to this change. Runs in a clean CI test DB.)
