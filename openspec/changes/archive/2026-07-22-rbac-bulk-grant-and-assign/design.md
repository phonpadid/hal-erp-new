## Context

`RbacAdminView.vue` drives both RBAC write flows through single-item forms. Each submit calls
a store action wrapped in `run()`, which after every write calls `reloadMutable()` — a serial
`loadAllPages` walk of `/rbac/roles` plus a refetch of the users page. Granting N permissions
therefore costs N POSTs **and N full catalog reloads**, serially. That reload cost, not the
click count, is what makes company onboarding slow.

Two facts from `erp_approval_system.dbml` shape the design:

- `role_permission` is unique on `(role_id, permission_id)` — a permission is held **once**
  per role, so changing a grant's scope is an UPDATE of the existing row, not a second row.
  Today the UI works around this by excluding held codes from the picker and telling the user
  to detach-then-re-add to change a scope.
- `user_company_role` is unique on `(user_id, company_id, role_id)` — a user holds each role
  **once per company**, regardless of department. So "role × department" is not a free
  matrix: department is a property of the single assignment, which is exactly why hoisting
  department to shared batch context is safe.

Neither table is an append-only ledger (only `budget_txn` and `approval_log` are), so
in-place UPDATE of `role_permission.scope` is permitted.

Current backend gaps this change must not inherit: `assignUserRole` does not verify that the
named `role` and `department` belong to the active company, and relies on the DB unique index
rather than an explicit duplicate check. The bulk path must validate properly, and the
single-item path should be refactored onto the same validation.

## Goals / Non-Goals

**Goals:**
- One request and one reload per administrator intent, instead of one per item.
- A manage-permissions surface where the checkbox state *is* the role's grant set, so adding,
  removing, and re-scoping are one coherent edit.
- Multi-role assignment over a shared department/default/window context.
- Explicit active-company validation on every bulk item, applied before any write.
- No breaking change to existing endpoints.

**Non-Goals:**
- No change to how permissions are *evaluated* at request time (`permission-resolver.service.ts`,
  `scope.service.ts` are untouched).
- No cross-company bulk writes. The batch is confined to the active company, per the company
  isolation invariant.
- No copy-role / role-template feature. Tempting adjacent scope; separate change.
- No change to `is_default` semantics beyond rejecting a batch that marks more than one.
- No budget or quota writes are involved, so no `budget_txn` sequencing or pessimistic
  locking applies to this change.

## Decisions

### 1. Diff editor over the full catalog, not an additive multi-select

**Chosen:** the manage surface renders the entire catalog with checkbox state seeded from the
role's current grants; commit sends the computed diff.

**Alternative rejected — additive multi-select** (check several unheld codes, "Add", remove
still via chips): a smaller change, but it keeps add and remove in two mental models and
leaves the "detach to re-scope" wart in place. The diff model makes the screen answer "what
does this role have?" directly, which is the question an administrator actually asks.

**Cost:** rendering the full catalog per role. Mitigated by the existing module grouping,
fixed-height scroll region, and text filter — the catalog is seed data of modest size and is
already loaded in full into the store (`loadAll` → `loadAllPages`).

### 2. Client computes the diff; server validates and applies it

The client sends `{ roleId, grants: [{permissionCode, scope}], detach: [permissionCode] }`.
The server does not trust the client's notion of "held" — it re-reads the role's current
grants inside the transaction and derives applied-vs-skipped itself. A client that sends a
grant for an already-held code with the same scope gets `skipped`, not a 409. This keeps a
stale client tab from producing a hard failure.

**Alternative rejected — client sends the desired full set, server diffs it:** cleaner
conceptually, but a stale client would silently detach grants added by another administrator
since the tab loaded. Sending explicit intent bounds the blast radius to what the user
actually touched.

### 3. Validate-all-then-write, inside one `em.transactional()`

Both bulk services follow: resolve and validate every item against the active company →
collect errors → reject the whole batch if any → apply. Per the concurrency rules in
CLAUDE.md the unit of work is a single `em.transactional(...)` so the batch commits
atomically; a partially-applied access change is worse than a rejected one because it leaves
the administrator unsure what took effect.

No pessimistic locking is used. Unlike budget reservation there is no read-then-decide race
to protect: the unique indexes on `(role_id, permission_id)` and
`(user_id, company_id, role_id)` are the authority, and two concurrent batches racing on the
same pair resolve to one winner plus a clean constraint error rather than an over-commit.

### 4. Idempotent within a batch, strict for single items

Duplicates are skipped in a batch but still 409 on `POST /rbac/role-permissions`. Rationale:
a batch expresses "make it so" over a set the user selected visually; a single-item call
expresses "add this one thing", where a duplicate is a genuine mistake worth surfacing.
Existing callers and tests of the single-item route keep their contract.

### 5. Response reports per-item outcomes

`{ applied: [...], skipped: [{ item, reason }] }` rather than a bare count, so the UI can say
"3 granted, 1 already held" instead of silently doing less than the user asked. This matters
precisely because the batch is forgiving.

### 6. Shared Zod schemas as the single source of truth

`bulkAttachPermissionsSchema` and `bulkAssignRolesSchema` live in `@erp/shared` next to the
existing `attachPermissionSchema` / `assignRoleSchema`, and both the Vue resolver and the
Nest DTO derive from them. The existing `validWindow` refinement is reused for the batch
window so the acting-window rule cannot drift between the single and bulk paths.

Note the `assignRoleBaseSchema` trap already documented in `RbacAdminView.vue`: context fields
that are not rendered `FormField`s blank out the submit payload if the resolver validates
them. The bulk schemas must expose a `.omit()`-able base object (a plain `ZodObject`, with the
window `.refine()` applied only in the full schema) for the same reason.

### 7. Batch size is bounded

`@ArrayMaxSize` on both bulk DTOs (proposed: 200 items). A batch is a UI-driven operation over
a catalog of known size; an unbounded array is a cheap way to hold a transaction open.

## Risks / Trade-offs

- **A stale tab detaches a grant another admin just added** → The diff carries explicit
  detach intent only for codes the user actually unticked, so an unrelated concurrent grant
  survives. Committing reloads role state, so the tab converges immediately after.

- **Full-catalog rendering makes the manage dialog heavy** → Module grouping stays collapsed
  by default and the list keeps its fixed-height scroll region; only expanded modules render
  rows. Revisit with virtual scroll only if the catalog outgrows the filter.

- **The diff editor makes mass-detach one click away** → Commit requires confirmation whenever
  the diff contains any detach, and the confirmation states the counts. This is a real
  regression in accident-resistance versus per-chip removal and the confirmation is the whole
  mitigation; it must not be dropped as "extra friction".

- **Adding company-scope validation to the shared path may reject data that previously wrote**
  → If any existing row was created cross-company by the unvalidated `assignUserRole`, the
  stricter path will now refuse to reproduce it. That is the company isolation invariant being
  enforced, not a regression, but it should be verified against the local dataset before
  rollout rather than discovered in use.

- **Partial-success reporting is easy to ignore in the UI** → The skipped list is surfaced in
  the success toast, not only in the response body; a commit where every item was skipped is
  reported as a warning, not a success.

## Migration Plan

No schema migration — no table or column changes; the bulk paths write the same
`role_permission` and `user_company_role` rows the single-item paths already write.

Ship order: shared schemas → backend services + endpoints (tests green, single-item routes
still passing their existing specs) → frontend rewrite. The backend is additive, so it can
land and sit unused; the frontend change is the only user-visible step.

Rollback: revert the frontend commit. The single-item endpoints are untouched, so the old
`RbacAdminView.vue` works against the new backend unchanged.

## Open Questions

- Should a batch where **every** item is skipped return 200 with an empty `applied` list
  (current assumption) or a 409? Leaning 200 — nothing failed, nothing was needed.
- Does the assign surface need a department **per checked role** in a later iteration? The
  `(user_id, company_id, role_id)` unique index means a user cannot hold the same role in two
  departments, which makes shared-department context sufficient for now, but multi-department
  onboarding still requires one batch per department.
