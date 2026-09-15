## Why

A user who holds roles in more than one department of the same company is invisible to half of
their own work. The company-context token carries a single `department_id` — the one on the
`is_default` assignment — and every DEPARTMENT-scoped read filters on that one id. The second
assignment contributes its permission codes (aggregation unions them) but contributes no
department, so a purchasing officer assigned to ບຸກຄະລາກອນ (default) and ພະແນກບໍລິຫານ answers
not-found for PR-HAL-2026-0001, a document of ພະແນກບໍລິຫານ, while a colleague with one role in
that department reads it normally. The configuration the administrator made is correct; the
resolver throws part of it away.

## What Changes

- **rbac — Company Context Token.** The token SHALL carry, in addition to the single home
  `department_id`, the set `department_ids` of every department the user holds an active
  (non-expired) assignment in for the active company. The home department stays what it is today
  (the `is_default` assignment, else the first) and remains the department new documents are
  raised in.
- **rbac — Data Scope Enforcement.** DEPARTMENT scope SHALL mean *any of the reader's departments
  in the active company*, not the home department alone. `ScopeService.scopeWhere` returns
  `dept IN (department_ids)`; an empty set matches nothing.
- **document-engine — Document Reads Are Narrowed To The Reader's Scope.** The DEPARTMENT clause
  of the document list / single read follows the same definition. (This requirement is introduced
  by the not-yet-archived change `document-visibility-by-scope`; this change modifies it.)
- **`GET /auth/me`** returns `departmentIds` alongside `departmentId`; the Pinia auth store keeps
  both.
- Not changed: which department a draft is created in, which document types are creatable, which
  budgets are selectable for a DOC_CREATE-at-DEPARTMENT caller. Those are *write-side* decisions
  bound to the home department and are out of scope here — see design.md.

No breaking change: `departmentId` keeps its meaning and its consumers; `departmentIds` is
additive. Existing single-assignment users see exactly what they see today (their one department is
the whole set).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `rbac` — *Company Context Token* gains `department_ids`; *Data Scope Enforcement* redefines the
  DEPARTMENT scope as the union of the reader's departments.
- `document-engine` — *Document Reads Are Narrowed To The Reader's Scope* (from
  `document-visibility-by-scope`): the DEPARTMENT clause reads "any department the caller is
  assigned to in the active company".

## Impact

Touches two of the nine capabilities: **rbac** (token, resolver, scope service) and
**document-engine** (the visibility predicate). Nothing in budget-control, quota, approval-workflow
or the ledgers moves.

Code:
- `back/src/modules/rbac/permission-resolver.service.ts` — resolve the set, not just the primary.
- `back/src/auth/jwt-payload.interface.ts`, `auth.service.ts`, `jwt.strategy.ts`,
  `jwt-or-api-key.guard.ts`, `common/context/request-context*.ts` — carry `departmentIds` through
  token → strategy → request context. Service accounts (API keys) resolve through the same
  resolver and get the same set.
- `back/src/modules/rbac/scope.service.ts` — `$in` for DEPARTMENT.
- `back/src/modules/document/document.service.ts` `visibleWhere` — the "resolved to no value"
  fail-safe becomes "resolved to an empty set".
- `back/src/modules/rbac/auth.controller.ts` `me`, `front-end/src/stores/auth.ts`.

Invariants: company isolation (1) is untouched — the set is resolved per company from
`user_company_role` rows of the active company only, and the em still applies the company filter
before the scope predicate. GROUP stays read-only and cross-company on its own path. Permission
codes, not role names (5), unchanged. Append-only ledgers and budget math are not in the path.

Risk: a token is re-issued only on login / company switch, so a newly added assignment widens
visibility on the user's next login, exactly as a newly granted code does today. Token size grows
by one uuid per extra assignment, which is a handful at most.
