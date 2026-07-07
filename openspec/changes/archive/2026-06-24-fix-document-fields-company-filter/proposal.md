## Why

`PUT /documents/:id/fields` (and the sibling lines endpoint) crash with
`Error: No arguments provided for filter 'company'`. `Document` extends
`CompanyScopedEntity`, so the default `company` filter is active on every query —
but `DocumentService.setFieldValues` / `setLines` load the document through a plain
`this.em.fork()` that never has the active company's `companyId` bound. The find
throws before any write. Beyond the crash, these mutation paths currently run
unscoped, which is also a company-isolation gap (invariant 1).

## What Changes

- Load the target document in `setFieldValues` and `setLines` through the
  company-scoped EntityManager (`this.scope.forActiveCompany()`) instead of a bare
  `this.em.fork()`, matching the read path in `get()`.
- A document belonging to another company resolves as not-found (404) on these
  endpoints rather than throwing a 500 or mutating across the isolation boundary.
- Add a concurrency-safe, scope-correct path: child writes (`doc_field_value`,
  `document_line`) continue to use `FILTER_OFF` where they are keyed by the already
  scope-verified parent document, so no behavior is lost there.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `document-engine`: clarify that document **content mutations** (field values and
  lines), not just reads, are company-scoped — a mutation targeting another
  company's document is rejected as not-found.

## Impact

- Code: `back/src/modules/document/document.service.ts` (`setFieldValues`,
  `setLines`, and the private `getWith` callers).
- APIs: `PUT /documents/:id/fields`, `PUT /documents/:id/lines` — fixed from 500 to
  working (or 404 for cross-company ids). No request/response shape change.
- Invariants: reinforces invariant 1 (company isolation) on write paths.
- No schema/migration change.
