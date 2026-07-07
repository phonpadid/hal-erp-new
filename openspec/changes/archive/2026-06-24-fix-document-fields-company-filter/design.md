## Context

`Document` extends `CompanyScopedEntity`, which declares a MikroORM `@Filter` named
`company` with `default: true`. The filter condition reads `args.companyId`, so any
query against `Document` requires that param to be bound on the EntityManager —
otherwise MikroORM throws `No arguments provided for filter 'company'`.

`CompanyScopeService.forActiveCompany()` is the seam that binds it:
`fork.setFilterParams('company', { companyId })`. The read path `get()` goes through
it. But the content-mutation methods do not:

```
async setFieldValues(documentId, values) {
  const em = this.em.fork();              // <- plain fork, no companyId bound
  const document = await this.getWith(em, documentId);  // findOne(Document,…) THROWS
  ...
}
```

`setLines()` has the same shape. `getWith` does `em.findOne(Document, { id })`, which
trips the unbound filter. This is both the reported 500 and a latent company-isolation
hole: a plain fork would (if it didn't throw) read/write any company's document.

`createDraft()` happens to work because it only queries `Company` and `DocumentType`,
which extend `BaseEntity` (not company-scoped) — so the filter never fires there.

## Goals / Non-Goals

**Goals**
- `PUT /documents/:id/fields` and `PUT /documents/:id/lines` succeed for the active
  company's documents.
- Cross-company `:id` resolves as not-found (404), consistent with the read path.
- Reinforce invariant 1 on these write paths.

**Non-Goals**
- No change to the `company` filter definition or to `CompanyScopeService`.
- No request/response shape change; no DB migration.
- No budget/quota ledger writes are involved in these endpoints, so no transactional
  sequencing change.

## Decisions

**Decision: route the mutation reads through `this.scope.forActiveCompany()` instead
of `this.em.fork()`.**
`setFieldValues` and `setLines` obtain their EntityManager from the scope service so
the `company` filter param is bound, exactly like `get()`. `getWith(em, id)` then
filters by the active company automatically, returning 404 (via its existing
`NotFoundException`) when the document is in another company.

- *Alternative — bind params manually in each method* (`em.setFilterParams('company',
  {companyId})`): works but duplicates the seam's logic and is easy to forget on the
  next mutation method. Rejected for consistency.
- *Alternative — disable the filter with `FILTER_OFF` on the parent find*: would
  silence the crash but reopen the isolation hole (any company's document mutable).
  Rejected — violates invariant 1.

**Decision: keep `FILTER_OFF` on the child-row writes inside `writeFieldValues` /
`writeLines`.** Those queries (`DocFieldValue`, `DocumentLine`) are keyed by the
already scope-verified parent `document.id`; `DocFieldValue`/`DocumentLine` extend
`BaseEntity` and are reached only through their parent, so leaving their existing
`FILTER_OFF` behavior is correct and avoids touching working code. The parent gate is
where isolation is enforced.

## Risks / Trade-offs

- [The scope service throws `No active company in context` if context is missing] →
  This is correct fail-closed behavior; the request layer always sets active company
  via middleware, and unauthenticated/contextless calls should not mutate documents.
- [A previously "working" client that relied on cross-company mutation] → None can
  exist: the endpoint currently 500s, so there is no behavior to preserve.

## Migration Plan

Pure code fix in `document.service.ts`. Deploy with the normal backend release; no
data migration. Rollback is reverting the two method bodies.

## Open Questions

None.
