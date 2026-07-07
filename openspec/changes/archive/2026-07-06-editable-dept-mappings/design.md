## Context

`dept_doc_type` binds `(department, document_type) → (form_template, workflow)` and is the
routing table the document engine reads at submit to pick a document's workflow. The config
surface for it is create-only: `document-config.controller.ts` exposes `GET /dept-doc-types`
and `POST /dept-doc-types`, and `DeptDocTypeService.create` ends in `persistAndFlush`. The
entity carries `@Unique(['department', 'documentType'])`, so a `POST` for an already-mapped
pair throws a raw driver error that Nest renders as **HTTP 500**. There is no update or delete
path, so an admin cannot repoint a mapping at a different workflow without editing the DB
directly. The frontend `DeptMappingsView.vue` can add and list mappings but not edit them.

This change adds an update path and turns the duplicate into a clean conflict, plus the UI edit
affordance. It touches two capabilities (`document-engine`, `web-doc-config`) but is small and
additive — no schema change.

## Goals / Non-Goals

**Goals:**
- `PATCH /document-config/dept-doc-types/:id` updates `workflow`, `form_template`, `is_active`,
  guarded by `DOC_CONFIG_MANAGE` and scoped to the active company.
- A duplicate `(department, document_type)` on create returns **409 Conflict** with a clear
  message, not 500.
- Edit affordance in `DeptMappingsView`, validated against a shared Zod schema.

**Non-Goals:**
- No `DELETE` of mappings (out of scope; deactivate via `is_active=false` instead).
- No change to how the engine resolves a workflow at submit, or to existing documents.
- No change to `department`/`document_type` of a mapping (identity is fixed; to change the pair,
  create a new mapping). Only workflow/template/active are editable.
- No DB migration — all target columns already exist on `dept_doc_type`.

## Decisions

**1. Reuse the create validation on update.** `create` already checks the template exists,
belongs to the document type, and is not `RETIRED`. `update` MUST apply the same checks against
the mapping's own `document_type` (which does not change on update). Extract the check into a
private helper both call. Alternative — skip validation on update — rejected: it would allow a
mapping to point at a retired or mismatched template.

**2. Detect duplicates explicitly rather than catching the DB error.** On `create`, do a
`findOne({ department, documentType })` first and throw `ConflictException` (→ 409) when a row
exists. Rationale: an explicit pre-check yields a clear, testable message and avoids parsing
driver-specific unique-violation codes. We keep the DB `@Unique` constraint as the last line of
defense against a race, and additionally wrap the flush so a unique-violation race also maps to
409 rather than 500. Alternative — rely solely on a `try/catch` around the driver error —
rejected as brittle and message-poor.

**3. Company scope via the mapping's department company.** `update`/the 409 pre-check resolve
the mapping and confirm it belongs to the active company (mirroring how `WorkflowConfigService`
guards its rows) before mutating; a mapping in another company is treated as **not found**.

**4. Shared update schema.** Add `deptDocTypeUpdateSchema` to `@erp/shared` (workflowId,
formTemplateId, isActive — all optional) and mirror it as `UpdateDeptDocTypeDto` with
class-validator + `ParseUUIDPipe` on `:id`. Client and server validate against the same shape,
per the project's single-source-of-truth rule.

**5. UI: edit dialog reusing the create form.** `DeptMappingsView` gets a per-row Edit action
opening the existing mapping form pre-filled, with `department` and `document type` shown
read-only (identity is fixed). Save calls `updateMapping(id, dto)`. A 409 from create/update is
surfaced as a field/toast message, not a generic failure.

## Risks / Trade-offs

- **Race between the 409 pre-check and flush** → the DB `@Unique` still rejects the second
  writer; we map that unique-violation to 409 as well, so the worst case is a clean conflict,
  never a 500 or a duplicate row.
- **Repointing a mapping mid-stream could surprise users** → documents already created keep
  their own `form_template_id`/`workflow_id`, so only future documents change; called out in the
  spec and worth a one-line note in the edit dialog.
- **Scope creep toward full CRUD** → deliberately excluding `DELETE`; deactivation covers the
  "stop using this mapping" need without orphaning references.

## Migration Plan

No data migration. Deploy backend (new DTO + endpoint + conflict handling) and frontend
together; the new route is additive and the UI edit action degrades gracefully if the backend
is older (button simply errors). Rollback is removing the route/handler — no persisted state
changes shape.

## Open Questions

- Should `is_active=false` hide the mapping from the document-create picker? Assumed **yes**
  already (create surface filters active mappings); confirm during apply and add a test if not
  already covered.
