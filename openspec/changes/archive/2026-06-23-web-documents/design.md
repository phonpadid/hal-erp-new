## Context

The Vue shell (`web-shell`) provides auth, the active-company context, the `api` client
(bearer + 401), route guards, and `can(code)`. document-engine exposes `GET /documents`,
`GET /documents/:id`, `POST /documents`, `PUT /documents/:id/fields|lines`,
`POST /documents/:id/submit|cancel|attachments`, and `GET /documents/:id/approval-log` — but
the only ways to learn creatable types / form fields are `DOC_CONFIG_MANAGE`-gated. The seed
gives demo users and a PR/MEMO/LEAVE config. No schema change.

## Goals / Non-Goals

**Goals**
- Two `DOC_CREATE` reads so non-admins can drive creation (creatable types + a type's form).
- Vue screens: My Documents (list), Document detail, Create/edit draft (dynamic form +
  lines), submit/cancel, attachment metadata.
- Permission/status-gated affordances; server errors surfaced.
- Tests: backend reads; frontend store/helpers + required-field validation.

**Non-Goals**
- Approver inbox (`web-approvals`), budget/quota dashboards, doc-config admin UI, S3 upload,
  full leave/quota UX.

## Decisions

### D1 — Backend: two thin reads on document-engine
Add to `DocumentService` + `DocumentController` (guarded `DOC_CREATE`, active dept from
`RequestContext`):
- `listCreatableTypes()` → `dept_doc_type` for the active department (active), returning each
  `documentType` `{ id, code, name, requiresBudget, requiresQuota }`.
- `formForType(documentTypeId)` → resolve the active dept's `dept_doc_type` for that type,
  return its `formTemplate` id/version + `form_field[]` `{ id, fieldName, fieldLabel,
  fieldType, isRequired, sortOrder }` (ordered). Rejects a type not mapped to the dept.
Both reuse `DeptDocTypeService.resolve` / a scoped query; no new entity. This is the
document-engine spec delta. *Alternative considered:* relax the existing config endpoints'
guard — rejected; those are admin reads, and a `DOC_CREATE` user shouldn't see all config.

### D2 — Frontend data layer
A typed `api/documents.ts` wrapping the endpoints (list, get, creatableTypes, formForType,
create, setFields, setLines, submit, cancel, attach, approvalLog) returning typed shapes.
A small `useDocumentsStore` (Pinia) for the list + current document + loading/error state;
views call the store. Money/amounts are strings throughout (never JS numbers), mirroring the
backend money rule.

### D3 — Create flow (draft-first, then fields/lines)
`createDraft` posts `POST /documents` with `documentTypeId` (+ currency/vendor) to get an id
and `doc_no`, then `PUT /documents/:id/fields` and `PUT /documents/:id/lines` with the
captured values. The form is built from `formForType` (D1): render an input per field by
`fieldType` (text/number/date/dropdown via PrimeVue), mark required, and validate required
client-side before save. Line editor: rows of description/qty/unitPrice/lineAmount (auto =
qty×unitPrice via `Money`-style string math), optional budget (a Select populated from
`GET /budgets` only when `can('BUDGET_VIEW')`) and optional item (`GET /items/enabled` when
`can('MASTER_VIEW')`). When a budget-controlled type has no budget pickable, the UI explains
that submit will require a budgeted line.

### D4 — Detail + submit/cancel
Detail loads `GET /documents/:id` + `GET /documents/:id/approval-log`. Buttons render by
`can()` + status: **Submit** when `can('DOC_SUBMIT')` && status `DRAFT`; **Cancel** when
`can('DOC_CANCEL')` && status in {DRAFT, SUBMITTED, IN_APPROVAL}. `submit` posts
`POST /documents/:id/submit`; server `BadRequest`/`Forbidden` messages (over-budget, missing
field, closed period, not-enabled, period) are shown in a banner and the document stays as
is. Routing into approval (start/act) is `web-approvals`' job — submit just leaves it
SUBMITTED.

### D5 — Routing & nav
Add routes under the shell: `documents` (list, `meta.permission = 'DOC_VIEW'`),
`documents/new` (`DOC_CREATE`), `documents/:id` (`DOC_VIEW`). Add a "Documents" nav item in
`AppShell` (gated by `DOC_VIEW`); make `documents` the post-login home (replacing the sample
`CompanyFormView`, which is retired or kept only as a config demo).

### D6 — Tests
- Backend (DB-backed): seed a dept mapping (reuse the seed helper or inline) and assert
  `listCreatableTypes` returns the mapped type and `formForType` returns its required field;
  a type not mapped to the dept is rejected.
- Frontend (Vitest + jsdom): documents store actions with a mocked `api` (list/create/submit
  set state; submit error surfaces), and a pure `validateRequired(fields, values)` helper
  (missing required → error; all present → ok). Build (`vue-tsc`) is the type gate.

## Risks / Trade-offs

- **Requester needs a budget for a PR** but the seeded Requester lacks `BUDGET_VIEW`, so the
  budget picker is hidden for them → documented: in the seed demo, create PRs as `admin`
  (has all perms); a later seed/role tweak can grant Requester `BUDGET_VIEW`. The UI degrades
  gracefully (explains the requirement) rather than breaking.
- **Two-call save** (draft then fields/lines) isn't atomic → acceptable for drafts; a failed
  follow-up leaves an empty draft the user can retry. (A combined create-with-content
  endpoint could come later.)
- **Dynamic form coverage**: support text/number/date/dropdown now; `file`/`line_items`
  field types fall back to text/are handled by the dedicated line editor — noted.

## Migration Plan

Backend: add the two reads + tests to document-engine; `pnpm --filter back build/test`.
Frontend: add `api/documents.ts`, `useDocumentsStore`, the three views, router/nav updates,
and tests; `pnpm --filter front-end build/test`. Run `openspec validate web-documents
--strict`. Rollback = revert the two backend methods + the `front-end/` additions.

## Open Questions

- Should `documents/new` prefill currency from the company base currency? Default: yes (show
  base currency, editable) so the common case is one click.
- Keep `CompanyFormView` as a config demo route or remove it? Default: remove from nav; leave
  the file until `web-org-admin` reuses the pattern.
