## Context

`PermissionResolverService.resolve(userId, companyId)` loads every active `user_company_role` row
of the user in the company, unions the permission codes of all their roles (broadest scope wins),
and then keeps exactly ONE department: the `is_default` row's, else the first row's. That single id
is stamped on the token as `departmentId`, restored into `RequestContext` by the JWT strategy (and
by the API-key guard for service accounts), and read by:

| consumer | question it asks | side |
|---|---|---|
| `ScopeService.scopeWhere` (DEPARTMENT case) | which rows may this reader see? | read |
| `DocumentService.visibleWhere` via `scopeWhere` | which documents may this reader see? | read |
| `DocumentService.createDraft` | which department is this draft raised in? | write |
| `DocumentService.listCreatableTypes`, `formForType` | which types/forms may this requester use? | write-side |
| `BudgetService.listSelectable` (DOC_CREATE at DEPARTMENT) | which budgets may this draft draw on? | write-side |

The read-side consumers are the bug: a second assignment adds codes but no department, so a
DEPARTMENT-scoped reader with two assignments sees only the default one. The write-side consumers
are not a bug — a draft must be raised in one department — and are left alone.

Constraints: the token is the only carrier of context (no per-request DB lookup of memberships —
`RequestContext` is filled from the payload); invariant 1 (company isolation) is applied by the
forked em before any scope predicate; `document-visibility-by-scope` (complete, not yet archived)
owns the current wording of the visibility requirements and this change must be archived after it.

## Goals / Non-Goals

**Goals:**
- A reader granted a code at DEPARTMENT scope sees the rows of EVERY department they hold an active
  assignment in for the active company.
- Single-assignment users are unaffected: their set is their one department.
- The list and the single read stay one predicate (the pending change's rule), so the fix lands in
  one place and both surfaces agree.
- Service accounts get the same semantics for free by going through the same resolver.

**Non-Goals:**
- Letting a user choose which of their departments a draft is raised in. That is a UI + DTO change
  (a `departmentId` on `CreateDocumentDto`, validated against the set) and a separate proposal.
- Widening `listCreatableTypes` / `formForType` / `listSelectable` to the union — they serve the
  draft-creation flow, which stays bound to the home department.
- Re-issuing tokens when an assignment changes. Today a new grant appears on the next login; a new
  department behaves the same way.
- Any change to GROUP scope or to the group-read em.

## Decisions

**D1 — Add `departmentIds: string[]` to the token; keep `departmentId`.**
Alternatives: (a) replace `departmentId` with the array and make the home department
`departmentIds[0]` — implicit ordering as meaning is fragile and every write-side consumer would
need touching; (b) look memberships up per request — moves authority out of the token, adds a
query to every request, and breaks the "the token IS the context" model the API-key path relies
on. Chosen: additive field. `departmentId` remains the home department (`is_default` else first)
and its consumers are untouched; `departmentIds` is the de-duplicated set of `department_id` over
the same filtered `user_company_role` rows the resolver already loads, and always contains
`departmentId`.

**D2 — `ScopeService.scopeWhere` returns `{ dept: { $in: departmentIds } }` for DEPARTMENT.**
One place, both consumers (document visibility today, anything that adopts `scopeWhere` later).
An undefined or empty set returns `MATCHES_NOTHING`-shaped input — see D3. Budget's
`listSelectable` reads `RequestContext.departmentId()` directly and is deliberately not switched
to `scopeWhere`: it is choosing a budget for a draft in the home department, not filtering a read.

**D3 — Fail-safe stays "match nothing", now for the empty set.**
`visibleWhere` today refuses when the DEPARTMENT predicate resolved to `undefined`/`''` so a
context without a department cannot reach Postgres as an invalid uuid (500) or match everything.
The same check becomes: the `$in` list is missing or empty → `MATCHES_NOTHING`. A token issued
before this change carries no `departmentIds`; the JWT strategy fills the set from `departmentId`
when the claim is absent, so an old token keeps its old (single-department) visibility until the
user next logs in rather than seeing nothing.

**D4 — `RequestContext` carries `departmentIds` as a plain string array; `/auth/me` returns it.**
The Pinia auth store stores both. No frontend guard branches on it yet — the client is UX only
and the server enforces — but the store having it means a later "which department am I raising
this in" picker has its data.

**D5 — Archive order: after `document-visibility-by-scope`.**
The document-engine delta here MODIFIES *Document Reads Are Narrowed To The Reader's Scope*, a
requirement that exists only in that change's delta. Its full text is reproduced here (per the
MODIFIED rule) with the DEPARTMENT sentence changed, so archiving this change second yields the
right final spec. Archiving it first would add a requirement the base spec does not yet have and
then the earlier change would overwrite it.

No budget_txn or quota_usage is written anywhere in this change, so there is no transaction
boundary or lock to specify; the only DB access changed is a read predicate.

## Risks / Trade-offs

- [A user with an assignment in many departments gets a long `IN` list on every document query] →
  Assignments are a handful per person in practice; the resolver de-duplicates. If a role ever
  needs "all departments" the right tool is COMPANY scope, not many assignments.
- [Token grows by one uuid per extra assignment] → negligible; a JWT of a five-department user is
  still under 2 KB.
- [Widening DEPARTMENT reads may surprise an administrator who used the default flag to hide the
  second department's documents] → That was never a documented behaviour; the spec has always said
  "documents of their department" and an assignment in a department IS membership. Called out in
  the proposal as the intended semantic.
- [An expired assignment (`valid_to` passed) must drop out of the set] → the set is built from the
  same validity-filtered rows the resolver already uses for grants; a unit test asserts an expired
  row contributes neither codes nor a department.
- [Old tokens in flight during deploy] → D3: missing claim falls back to `[departmentId]`.

## Migration Plan

Deploy backend then frontend; no migration, no data change. Users pick up the wider visibility on
their next login or company switch. Rollback is a redeploy of the previous backend: tokens carrying
the extra claim are still valid (unknown claims are ignored by the strategy).

## Open Questions

- None blocking. Whether a draft may be raised in a non-home department is deferred to its own
  proposal (see Non-Goals).
