## Why

`GET /reports/document-summary` returns HTTP 500 (`TypeError: Cannot read properties of undefined
(reading 'localeCompare')` at `reporting.service.ts:417`). The document-summary report crashes
instead of rendering, so the report page is unusable whenever the underlying data hits the failing
path.

## What Changes

- Fix `ReportingService.documentSummary` so it never throws when a document's `documentType`
  cannot be fully resolved. The row/sort keys are built from `d.documentType.code`
  (`typeCode`); when the populated `documentType` is an unhydrated or missing reference, `.code`
  is `undefined` (its FK `.id` still resolves, which is why grouping starts but the final
  `Array.sort` → `localeCompare(undefined)` throws), producing the 500.
- Make the report robust: group by the always-present `documentType.id`, treat the
  code/name/category as best-effort with a defined fallback when the type row is unresolved, and
  sort with a null-safe comparison so an anomalous row degrades gracefully instead of failing the
  whole endpoint.
- Add a regression test that reproduces the crash (a document whose `documentType` does not
  resolve) and asserts the report returns rows without throwing.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `reporting`: the **Document Reporting** requirement gains an explicit robustness guarantee — the
  document-summary report SHALL still return its grouped rows and per-status totals even when a
  document's type cannot be fully resolved, rather than failing the request.

## Impact

- **Code:** `back/src/modules/reporting/reporting.service.ts` (`documentSummary`, the row build at
  ~line 394–405 and the sort at ~line 416–418).
- **Tests:** `back/src/modules/reporting/reporting.service.spec.ts` (new regression case).
- **No DB/migration/DTO/API-shape change.** `DocumentSummaryRow` keeps its fields; only their
  population is made defensive. No core invariant is touched — the endpoint stays company-scoped
  and permission-gated; this only stops it from 500-ing on an unresolved document type.
