## Context

The reference chain (predecessor→successor document-type pairings) is the backbone of two
behaviors: create-from-predecessor validation in
[document.service.ts:190](../../../back/src/modules/document/document.service.ts#L190) and
the `CREATE_PO` post-action's successor resolution in
[post-action.service.ts:89](../../../back/src/modules/approval/post-action.service.ts#L89).
Both read pairings through two helpers, `isRefPairingAllowed()` and `successorTypesFor()`,
which today consult a hardcoded object `REF_CHAIN` in
[ref-chain.config.ts](../../../back/src/modules/document/ref-chain.config.ts):

```
PO: ['PR', 'PROC'],  DISB: ['PO'],  CLEAR_ADVANCE: ['ADVANCE']
```

The helper indirection was deliberately added ("so the storage can later move to the
database without touching call sites"), so the seam already exists. Two problems remain:
the pairings require a code change to alter (violates configuration-over-code, invariant 7),
and they key on the type `code` string globally even though `document_type` is
company-scoped, so a company cannot have its own chain (weakens invariant 1).

## Goals / Non-Goals

**Goals:**
- Store pairings as company-scoped data in a new `document_type_ref` table.
- Keep create-from and `CREATE_PO` behavior observably identical for existing seeded chains.
- Preserve company isolation: a pairing links two `document_type` rows in the same company.
- Let a `DOC_CONFIG_MANAGE` admin edit pairings from the document-type config UI.

**Non-Goals:**
- Changing `CREATE_PO` auto-create semantics (still: exactly one successor → create).
- Moving other config (`post_action`, workflow, forms) — only the ref chain moves.
- Multi-hop chain traversal or validation of chain cycles beyond the single-pairing check.
- Any ledger, numbering, or FX behavior — none is touched, so no concurrency test is added.

## Decisions

### Decision 1: A join table, not a self-referential FK on `document_type`
`document_type_ref { id, company_id, predecessor_type_id, successor_type_id }` with a unique
index on `(company_id, predecessor_type_id, successor_type_id)`. Both FKs reference
`document_type`.

- **Why:** the relation is many-to-many — `PO` has predecessors `PR` **and** `PROC`. A
  single `successor_type_id` column on `document_type` would cap each type at one successor
  and cannot express the reverse fan-in. The join table mirrors `REF_CHAIN` exactly and
  matches the existing `dept_doc_type` pattern (a company-scoped join with a unique pair
  index).
- **Alternative considered:** nullable `successor_type_id` FK on `document_type` (simplest,
  one column). Rejected: too restrictive (one successor per type) and asymmetric to model.

### Decision 2: `company_id` is stored on the pairing, and both types must match it
Rather than derive the company by joining through either type, `document_type_ref` carries
its own `company_id` (like every other main table, invariant 1). On create, the service
SHALL verify both `predecessor_type` and `successor_type` belong to that company; a pairing
whose endpoints are not both in-company is rejected. Lookups filter by the active company.

- **Why:** makes the isolation invariant enforceable with a single scoped query and keeps the
  table uniform with the rest of the schema. Seeding and the admin API both go through the
  same company check.

### Decision 3: Helpers become async + company-scoped; call sites already have context
`isRefPairingAllowed()` and `successorTypesFor()` are rewritten to query `document_type_ref`
via the MikroORM `EntityManager`, scoped to the active company:

- `isRefPairingAllowed(em, companyId, predecessorTypeId, successorTypeId)` → boolean
- `successorTypesFor(em, companyId, predecessorTypeId)` → `DocumentType[]` (or codes)

Both call sites already run inside a company-scoped `em` with the entity loaded, so no new
plumbing is needed:
- `document.service.ts` has the scoped `em` and the loaded `predecessor.documentType`.
- `post-action.service.ts` runs inside `em.transactional` with the loaded `type` and the
  document's company.

Resolving by **id** (not code) also sidesteps the known "populate returns an unloaded stub"
pitfall — the services already hold the type entities, so we pass ids. The `CREATE_PO`
"exactly one successor" rule stays in `post-action.service.ts` unchanged: it counts the rows
`successorTypesFor` returns and only creates when the count is 1.

### Decision 4: Seed migration back-fills existing pairings per company
A data step (in the seed and/or migration) inserts, for every company that owns the matching
types, the rows for `PR→PO`, `PROC→PO`, `PO→DISB`, `ADVANCE→CLEAR_ADVANCE`, resolving each
side's `document_type.id` by `(company_id, code)`. Companies missing a type simply get no row
for that pairing (consistent with today's no-op behavior). `REF_CHAIN` and the sync helpers
are then deleted; `ref-chain.spec.ts` is reworked to exercise the DB-backed helpers.

### Decision 5: Admin API + UI live in the existing document-type config surface
Add REST endpoints under the document-type config module, guarded by `DOC_CONFIG_MANAGE`:
list a type's successor/predecessor pairings, add a pairing, delete a pairing. All are
company-scoped and reuse the same-company validation from Decision 2. The Vue/PrimeVue
document-type editor gains a pairings section (MultiSelect or add/remove list of
active-company types, excluding self), gated by the permission code from the Pinia
active-company context, with a Zod DTO mirroring the server. Duplicate adds are blocked
client-side and by the unique index server-side.

## Risks / Trade-offs

- **Seed misses a chain for a company that lacks a type** → behavior is identical to today
  (that pairing was already a no-op); admins can add it later in the UI. Acceptable.
- **Extra DB round-trip per create-from / CREATE_PO** (was an in-memory lookup) → the query
  is a single indexed lookup on `(company_id, predecessor_type_id[, successor_type_id])`;
  negligible next to the surrounding transaction. Mitigation: index defined on the table.
- **A dangling pairing if a `document_type` is hard-deleted** → types are soft-deleted via
  `is_active`, not removed; FK constraints (and, if desired, ON DELETE CASCADE) keep the
  join consistent. Lookups already resolve the successor type as `is_active: true`.
- **Cross-company pairing slips in via a crafted request** → both endpoints are re-validated
  against the pairing's `company_id` on write; the lookup is company-scoped on read. Covered
  by the "same-company types" scenario.

## Migration Plan

1. Add `document_type_ref` to `erp_approval_system.dbml` (+ its two `Ref:` lines) and create
   the MikroORM entity.
2. Generate the schema migration for the new table + unique index + FKs.
3. Data back-fill (migration/seed): insert the four existing pairings per eligible company.
4. Switch the helpers to DB-backed and update both call sites; delete `REF_CHAIN`.
5. Add the config endpoints + DTOs and the UI pairings editor.
6. Rollback: the change is additive at the schema level; reverting code restores `REF_CHAIN`
   from git, and the table can be dropped. No ledger or append-only data is affected.

## Open Questions

- Should deleting a `document_type_ref` pairing be a hard delete or an `is_active` soft
  delete for auditability? (Leaning hard delete — it is pure config, not a ledger.)
- Do we expose pairing management only on the document-type edit screen, or also as a
  standalone "reference chain" matrix view? (Start with the per-type editor.)
