## Why

A `dept_doc_type` mapping today can only be **created**, never changed: the API exposes
`GET` + `POST` but no update, and `POST` of an already-mapped `(department, document_type)`
pair hits the `@Unique` constraint and surfaces as an opaque **HTTP 500**. An admin who
needs to repoint a department's document type at a different workflow (the common case:
moving a PR from "Standard Approval" to a full approval chain) has no supported path — the
only workaround is a manual `UPDATE` against the database.

## What Changes

- Add `PATCH /document-config/dept-doc-types/:id` to update an existing mapping's
  `workflow`, `form_template`, and/or `is_active`. Validation mirrors create (template must
  belong to the mapping's document type and not be `RETIRED`); the endpoint is guarded by
  `DOC_CONFIG_MANAGE` and scoped to the active company.
- Make a duplicate mapping return **HTTP 409 Conflict** with a clear message instead of a
  500, on both create (existing pair) and — where relevant — update.
- Frontend: add an **Edit** affordance to the Department Mappings view so a
  `DOC_CONFIG_MANAGE` user can change a mapping's workflow / form template / active state,
  validated client-side against a shared Zod schema mirroring the update DTO.

## Capabilities

### New Capabilities
<!-- none — this extends existing capabilities -->

### Modified Capabilities
- `document-engine`: the per-department mapping requirement gains **update** semantics
  (change workflow/form/active on an existing mapping) and a **conflict** rule (a duplicate
  `(department, document_type)` is rejected with a conflict error, not a server error).
- `web-doc-config`: the Department Document Mapping requirement gains an **edit** affordance
  to change an existing mapping's workflow, template, and active state.

## Impact

- **Backend:** `document-config.controller.ts` (new `PATCH` route), `dept-doc-type.service.ts`
  (new `update`, duplicate → conflict on `create`), a new `UpdateDeptDocTypeDto`, shared
  update schema. No DB migration — `dept_doc_type` already carries all needed columns.
- **Frontend:** `DeptMappingsView.vue` (edit dialog/row action), `docConfig.ts` store + api
  client (`updateMapping`), shared Zod schema in `@erp/shared`.
- **Invariants:** company scope enforced on the update (a mapping in another company is not
  found, not editable); permission-code guard (`DOC_CONFIG_MANAGE`) unchanged. `dept_doc_type`
  is a configuration table, not an append-only ledger, so an in-place `UPDATE` is allowed and
  breaks no ledger invariant. Existing documents retain their own `form_template_id` /
  `workflow_id`, so repointing a mapping only affects **future** documents.
