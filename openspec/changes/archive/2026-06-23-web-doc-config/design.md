## Context

The config write surface exists. `DocumentConfigController` (`@Controller('document-config')`,
class `DOC_CONFIG_MANAGE`): POST document-types, GET document-types, PATCH document-types/:id, POST
form-templates, POST form-templates/:id/publish, GET form-templates/:id/fields, POST form-fields,
POST dept-doc-types. `ApprovalConfigController` (`@Controller('workflows')`, class
`WORKFLOW_MANAGE`): POST `/`, POST `/steps`, POST `/delegations`. Services use
`RequestContext.companyId()`. DTO shapes: document-type (code, name, category ∈ PROCUREMENT/
FINANCE/HR/ADMIN/IT, requiresBudget?, requiresQuota?, postAction?); form-field (formTemplateId,
fieldName, fieldLabel, fieldType, isRequired?, sortOrder?, optionsJson?); dept-doc-type
(departmentId, documentTypeId, formTemplateId, workflowId); workflow (name, conditionJson?);
workflow-step (workflowId, stepNo, stepName?, approverRoleId?/approverUserId?, amountMin?/Max?,
approveMode ∈ SEQUENTIAL/PARALLEL_ALL/PARALLEL_ANY, slaHours?). `FormTemplateService.createTemplate`
auto-increments version. Missing for a UI: list-templates-by-type, list-dept-mappings, and
list-workflows-with-steps. The shell + prior slices give `can()`, the typed-api/store pattern,
`@primevue/forms` + `zodResolver`, `@erp/shared`, and `GET /departments` + `GET /rbac/roles`.

## Goals / Non-Goals

**Goals**
- Config reads (templates-by-type, dept mappings, workflows+steps) under their manage perms,
  active-company scoped.
- Vue Configuration admin: Document Types · Forms · Mappings · Workflows, forms validated against
  shared Zod schemas.
- Tests: the three reads; doc-config store + shared schemas.

**Non-Goals**
- Delegation management, drag-and-drop builders, in-place editing of published templates,
  condition-rule editors.

## Decisions

### D1 — Backend reads (document-engine)
- `FormTemplateService.listForType(documentTypeId)` → templates for the type with
  `{ id, version, status, fieldCount }` (count via a grouped query or per-template length). Route
  `GET /document-config/form-templates?documentTypeId=`.
- `DeptDocTypeService.listForCompany()` → active-company `dept_doc_type` rows with
  `{ id, departmentId, departmentName, documentTypeId, documentTypeCode, formTemplateId,
  templateVersion, workflowId, workflowName }` (batch-resolve names by id, the established pattern,
  not relation populate). Route `GET /document-config/dept-doc-types`. Both inherit the controller's
  `DOC_CONFIG_MANAGE` guard.

### D2 — Backend read (approval-workflow)
`WorkflowConfigService.listWorkflows()` → active-company workflows + their steps:
`{ id, name, isActive, steps: [{ id, stepNo, stepName, approverRoleId, approverUserId, amountMin,
amountMax, approveMode, slaHours }] }`, steps ordered by `stepNo`. Route `GET /workflows`
(inherits `WORKFLOW_MANAGE`). Step approver *names* are resolved in the UI from `GET /rbac/roles`
(admin holds `RBAC_MANAGE`); the read returns ids to stay within the workflow capability.

### D3 — Shared Zod schemas
Add to `@erp/shared`, mirroring the DTOs: `documentTypeSchema`, `formFieldSchema`,
`deptDocTypeSchema`, `workflowSchema`, `workflowStepSchema`, plus enums `DOC_CATEGORIES`,
`FIELD_TYPES` (text/number/date/dropdown), `APPROVE_MODES`, `POST_ACTIONS` (e.g. NONE/CUT_BUDGET/
…). Forms use `zodResolver` so client/server validation can't drift (CLAUDE.md).

### D4 — Frontend data layer
`api/docConfig.ts`: documentTypes (list/create/update), formTemplates (listForType/create/publish/
fields/addField), deptDocTypes (list/create), workflows (list/create/addStep). `stores/docConfig.ts`
(Pinia): `documentTypes`, `templatesByType` (keyed), `fieldsByTemplate`, `mappings`, `workflows`,
plus `departments` and `roles` (for pickers), `loading`, `error`; loaders + mutation wrappers that
refresh; capture errors.

### D5 — Tabbed Configuration view
`views/admin/DocConfigView.vue` with PrimeVue `Tabs`:
- **Document Types**: table + create/edit dialog (category/flags/post-action selects, validated).
- **Forms**: pick a document type → its templates (version + status) → select a template to show
  its fields; "New template", "Add field" (with type/required/order), "Publish".
- **Mappings**: table of dept-doc-types + "New mapping" dialog (department, document type,
  template, workflow selects).
- **Workflows**: table of workflows + steps (chips/rows); "New workflow" + "Add step" dialog
  (approver role select from `/rbac/roles`, mode, amount range, SLA).
Manage controls gated by `can('DOC_CONFIG_MANAGE')`; the Workflows tab's writes additionally by
`can('WORKFLOW_MANAGE')`. Dialogs use `<Form :resolver>` + `<FormField>` + `<Message>`.

### D6 — Routing & nav
Route `doc-config` (`meta.permission='DOC_CONFIG_MANAGE'`); a "Configuration" nav item gated by
`can('DOC_CONFIG_MANAGE')` (admin in the seed). The view also reads `can('WORKFLOW_MANAGE')` to
gate the Workflows writes.

### D7 — Tests
- Backend (DB-backed, reuse `seedDatabase`): `listForType(PR)` returns the seeded v1 template with
  `fieldCount ≥ 1`; `listForCompany()` returns the seeded PROC mappings (PR/MEMO/LEAVE) with their
  template + workflow; `listWorkflows()` returns "Standard Approval" with its step 1; reads are
  active-company scoped.
- Frontend (Vitest): doc-config store with a mocked api (loaders populate; create/addField/addStep
  call the right endpoint and refresh; error captured); shared-schema validation (valid/invalid
  document type, field, mapping, workflow step; bad category/mode/field-type rejected).

## Risks / Trade-offs

- **Breadth** — four config domains in one slice; mitigated by the shared tabbed view + one store,
  and by reusing existing writes (only reads are new). Each tab is independently testable.
- **Cross-capability role picker** — workflow steps need role names from `GET /rbac/roles`
  (`RBAC_MANAGE`). Admin has it; a `WORKFLOW_MANAGE`-only user would see ids without names. Noted;
  a light roles read under `WORKFLOW_MANAGE` could come later.
- **Published-template immutability** — editing fields after publish requires a new version
  (backend auto-versions); the UI surfaces "New version" rather than in-place edits. Documented.

## Migration Plan

`shared`: add schemas/enums; build. Backend: add the three reads + tests. Frontend: add
`api/docConfig.ts`, `stores/docConfig.ts`, `DocConfigView.vue`, router/nav, tests. `pnpm -r build`
+ both suites; `openspec validate web-doc-config --type change --strict`. Rollback = revert the
read additions and the `front-end/` + `shared/` additions.

## Open Questions

- Show inactive document types/workflows? Default: list all, with an active toggle on types; no
  separate filter this slice.
- Field `optionsJson` editor? Default: a raw text input validated as optional JSON string; a
  structured option-list editor is a later enhancement.
