## Context

`ReportingService.documentSummary` (`back/src/modules/reporting/reporting.service.ts`) loads the
active company's documents with `populate: ['documentType']`, groups them into a `Map` keyed by
`` `${d.documentType.id}::${d.status}` ``, and finally sorts:

```ts
const rows = [...rowMap.values()].sort(
  (a, b) => a.typeCode.localeCompare(b.typeCode) || a.status.localeCompare(b.status),
);
```

`typeCode` is set from `d.documentType.code`. When the populated `documentType` is an unhydrated
reference (its FK `id` resolves — so `d.documentType.id` on line 394 does not throw and grouping
proceeds — but its scalar columns are `undefined`), `typeCode` becomes `undefined` and
`undefined.localeCompare(...)` throws a `TypeError`, which NestJS turns into a 500. `status` is a
non-nullable enum (`DocStatus`, default `DRAFT`), so it is never the undefined operand — the fault
is specifically the type code.

This is a read-only report: no `budget_txn` / `quota_usage` write, no ledger, no transaction
boundary or lock is involved. The endpoint is already company-scoped (`where.company`) and
permission-gated; this change only prevents the crash.

## Goals / Non-Goals

**Goals:**
- The endpoint returns the grouped summary and per-status totals without throwing, even if a
  document's `documentType` is unresolved.
- Counts and base totals stay correct; grouping stays keyed by the document type identity.
- A regression test reproduces the original crash and passes after the fix.

**Non-Goals:**
- No change to `DocumentSummaryRow`/`DocumentStatusTotal` shape or the API contract.
- Not fixing any underlying data anomaly (an orphaned/missing `document_type` row) — that is a
  data concern; the report must be resilient regardless.
- No change to the other report methods, DTOs, DB schema, or migrations.

## Decisions

- **Keep grouping by type identity.** The group key stays `` `${d.documentType.id}::${d.status}` ``
  — `id` is always available (it comes from the FK even on an unhydrated reference), so counts and
  totals for that type remain correctly aggregated.
- **Fallback for display fields.** When building a row, coalesce the type scalar fields to defined
  values so downstream sorting/rendering never sees `undefined`:
  ```ts
  typeCode: d.documentType.code ?? d.documentType.id,
  typeName: d.documentType.name ?? d.documentType.id,
  category: d.documentType.category ?? 'UNKNOWN',
  ```
  Using the id as the code/name fallback keeps the row identifiable; `category` falls back to a
  sentinel. (Chosen over dropping such documents, which would silently under-count, and over a
  hard failure, which is the current bug.)
- **Null-safe sort as defense in depth.** Even with the fallback, sort on the already-defined row
  fields (`a.typeCode`/`b.typeCode`, `a.status`/`b.status`), which are now guaranteed strings.
  This keeps the comparator total and order deterministic.
- **Regression test.** In `reporting.service.spec.ts`, construct the failing condition — a
  document whose `documentType` does not resolve to a full row — and assert
  `documentSummary()` resolves with rows (length ≥ 1) and does not throw. Prefer forcing the
  unhydrated-reference path the same way production hits it, so the test would have caught the
  original 500.

## Risks / Trade-offs

- **Masking a data anomaly.** Falling back instead of failing means an orphaned document type no
  longer surfaces as an error. Acceptable: a reporting endpoint should not 500 on read; the
  fallback code/name (the type id) makes the anomaly visible in the output rather than hidden.
- **Fallback label choice.** Using the type id as the code/name is a pragmatic, unambiguous
  placeholder; if a friendlier label is later desired it is a one-line change and does not affect
  grouping.
