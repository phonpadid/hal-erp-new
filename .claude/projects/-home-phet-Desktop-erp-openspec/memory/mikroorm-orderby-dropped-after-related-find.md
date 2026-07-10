---
name: mikroorm-orderby-dropped-after-related-find
description: em.find orderBy is silently dropped when a preceding find in the same fork touched a related entity; sort in JS
metadata:
  type: reference
---

In a single `em.fork()`, calling `em.find(A)` and then `em.find(B, { orderBy })` where A has a
`@ManyToOne(() => B)` can cause MikroORM (v6.6.x) to **silently drop the orderBy on the B query**,
returning insertion order instead. Reproduced with `DocFieldValue` (→ `FormField`) then
`FormField` ordered by `sortOrder`: the same query in a fresh fork orders correctly, but after the
`DocFieldValue` find it comes back unsorted. Not blanket poisoning — `WorkflowStep` ordering in the
same builder was unaffected — so it's tied to the A→B relationship, not all subsequent queries.

**How to apply:** don't trust the query's `orderBy` for the second entity; sort in JS after the
find (e.g. `fields.sort((a, b) => a.sortOrder - b.sortOrder)`). Seen in
`document-pdf.service.ts` buildModel. Related: [[documenttype-populate-unloaded-ref]].
