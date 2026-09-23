## Context

`DocumentService.visibleWhere` builds one predicate for the list, `get`, `detail` and
`assertVisible`: `scopeWhere(DOC_VIEW)` (OWN / DEPARTMENT-set / COMPANY) OR-ed with the ids of
documents the reader is party to. It knows a document's creator and department; it knows nothing
about its type. `document_type` already carries a dozen behaviour flags that services branch on
(invariant 7), all validated in `DocumentTypeService` (`category` and `default_gl_account` as soft
code references). The permission catalog is the `permission` table (global, `code` unique,
`is_active`); the resolved grants on the request are `RequestContext.grants()`.

The reporting user is a ພະນັກງານ at DEPARTMENT scope who sees 106 `BUDGET_PLAN` documents raised
in their department by the budget officer. The correct configuration — requesters see their
department's requests, budget people see budget plans — cannot be expressed today.

## Goals / Non-Goals

**Goals:**
- A type can declare "reading me needs code X" as data; the visibility predicate honours it.
- The gate is a read-only narrowing of the *default* visibility: creators and parties keep access,
  actions keep their own guards.
- Zero change for types without a gate (every existing type).
- The administrator picks the code from the catalog by name, not by typing it.

**Non-Goals:**
- Gating by category, by department mapping, or by scope on the gate code (a code held at any
  scope satisfies it; scope still comes from `DOC_VIEW`).
- Hiding a gated type from the approval inbox — the inbox is not filtered by `DOC_VIEW` at all
  (existing test) and stays that way.
- Changing which types are gated in seed data. The migration adds the column null; setting
  `BUDGET_PLAN → BUDGET_VIEW` is a configuration act the administrator performs (or a follow-up
  seed change), not a schema default.
- Gating other content reads (PDF, attachments, 3-way match) separately — they already go through
  `assertVisible`, so they inherit the gate for free.

## Decisions

**D1 — Column `document_type.view_permission_code varchar null`, a soft code reference.**
Alternatives: (a) a hard FK to `permission.id` — the catalog is global and other soft refs on this
table (`category`, `default_gl_account`) are codes, and codes are what the rest of the system
authorises on (invariant 5); (b) a join table for several codes — no case needs "any of two codes",
and a role that should see the type can simply be granted the one code. Chosen: one nullable code,
validated on create/update against `permission` with `is_active = true`; an unknown or inactive
code is rejected with a message naming it. Null (or empty string from the form, normalised to
null) means ungated.

**D2 — The gate lives in `visibleWhere`, on the scope half only.**
```
gatedTypeIds = ids of active-company document_type rows whose view_permission_code is set
               and NOT in the reader's grant codes
scopeHalf    = scoped AND (documentType NOT IN gatedTypeIds OR createdBy = userId)
visible      = scopeHalf OR id IN partyIds
```
The party half is untouched, so the pending requirement's guarantee ("a scope does not hide a
record the reader is party to") holds for the gate too — a department head asked to approve a
budget plan opens it without `BUDGET_VIEW`. `createdBy = userId` is added explicitly because the
current party sources (approval_log, step actors, escalation, delegation) do not include the
creator; without it a budget officer who lost `BUDGET_VIEW` could not see plans they raised, which
would be a new and surprising rule. When `gatedTypeIds` is empty the predicate is unchanged — the
common case pays one small query on `document_type` per read.

Alternative considered: filtering in `buildDocumentFilter` (the caller-supplied filter). Rejected —
a filter narrows and can be omitted; the gate is authorisation-shaped and belongs with the
predicate the list and the single read share.

**D3 — One query for the gated set, read through the company-filtered em.**
`em.find(DocumentType, { viewPermissionCode: { $ne: null } }, { fields: ['id','viewPermissionCode'] })`
on the same forked em `visibleWhere` receives, so the company filter applies (invariant 1). The
codes the reader holds come from `RequestContext.grants()` — no scope comparison, any scope
satisfies. COMPANY and GROUP scope no longer short-circuit to `{}` when a gate exists; they
short-circuit only when no type of the company is gated.

**D4 — A permission-code read under `DOC_CONFIG_MANAGE`.**
`GET /document-config/permission-codes` → `[{ code, name, module }]` of active catalog rows. The
existing `GET /rbac/permissions` sits under `RBAC_MANAGE`; a document-config administrator is not
necessarily an RBAC administrator, and the form must not require that. It returns codes and names
only — no scopes, no roles — so it discloses nothing the catalog itself does not already declare
in source.

**D5 — Shared Zod schema + DTO gain `viewPermissionCode: string | null | undefined`.**
Mirrors `authoringRoute`. The form normalises `''` to `null` before sending (the same rule the
DBML states for `post_action`: one spelling of "none").

No `budget_txn` or `quota_usage` is written; the only new DB access is a read predicate and a
nullable column. No lock, no transaction boundary to specify.

## Risks / Trade-offs

- [An admin gates a type with a code nobody holds] → creators and workflow parties still see it,
  so nothing is stranded; the form shows the code's human name so the choice is deliberate.
  Documented in the field hint.
- [Extra query on every document read] → one indexed read of a small config table, cached by
  MikroORM's identity map within the request; skipped entirely when no gate exists. If it ever
  matters, gated types can be cached per company with the doc-type cache the wizard already uses.
- [A reader holding the gate code at OWN scope] → the gate is satisfied (any scope); visibility is
  still bounded by their `DOC_VIEW` scope. Stated in the spec so nobody expects the gate's scope
  to matter.
- [Permission catalog row deactivated after being set as a gate] → the gate still names it; no
  reader can hold an inactive code (aggregation skips them), so the type becomes creator/party-only
  until the admin clears or changes the gate. The type-config read reports the code so this is
  visible, not silent.

## Migration Plan

Migration adds the nullable column; entities and DBML updated together. Deploy backend then
frontend. No data is written by the migration; gating `BUDGET_PLAN` is done in the admin UI
afterwards (or by a seed follow-up). Rollback: the previous backend ignores the column.

## Open Questions

- None blocking. Whether seed data should gate `BUDGET_PLAN` by default is left to the seed
  owner; this change makes it expressible.
