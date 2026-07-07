## 1. Shared schemas

- [x] 1.1 In `@erp/shared`: `documentTypeSchema` (code, name, category, requiresBudget?, requiresQuota?, postAction?), `formFieldSchema` (formTemplateId, fieldName, fieldLabel, fieldType, isRequired?, sortOrder?, optionsJson?), `deptDocTypeSchema` (departmentId, documentTypeId, formTemplateId, workflowId), `workflowSchema` (name, conditionJson?), `workflowStepSchema` (workflowId, stepNo, stepName?, approverRoleId?, approverUserId?, amountMin?, amountMax?, approveMode, slaHours?); enums `DOC_CATEGORIES`, `FIELD_TYPES`, `APPROVE_MODES`, `POST_ACTIONS`. Build.

## 2. Backend: document-engine reads

- [x] 2.1 `FormTemplateService.listForType(documentTypeId)` → `[{ id, version, status, fieldCount }]`.
- [x] 2.2 `DeptDocTypeService.listForCompany()` → active-company mappings `[{ id, departmentId, departmentName, documentTypeId, documentTypeCode, formTemplateId, templateVersion, workflowId, workflowName }]` (batch-resolve names by id).
- [x] 2.3 `DocumentConfigController`: `GET /document-config/form-templates?documentTypeId=` and `GET /document-config/dept-doc-types` (inherit class `DOC_CONFIG_MANAGE`).

## 3. Backend: approval-workflow read

- [x] 3.1 `WorkflowConfigService.listWorkflows()` → active-company workflows with steps `[{ id, name, isActive, steps: [{ id, stepNo, stepName, approverRoleId, approverUserId, amountMin, amountMax, approveMode, slaHours }] }]` (steps ordered by stepNo).
- [x] 3.2 `ApprovalConfigController`: `GET /workflows` (inherits class `WORKFLOW_MANAGE`).

## 4. Backend test

- [x] 4.1 DB-backed (reuse `seedDatabase`): `listForType(PR)` returns the v1 template with `fieldCount ≥ 1`; `listForCompany()` returns the PROC mappings (PR/MEMO/LEAVE) with template + workflow; `listWorkflows()` returns "Standard Approval" with step 1; reads are active-company scoped.

## 5. Frontend data layer

- [x] 5.1 `api/docConfig.ts`: documentTypes (list/create/update), formTemplates (listForType/create/publish/fields/addField), deptDocTypes (list/create), workflows (list/create/addStep); plus departments + roles fetch helpers.
- [x] 5.2 `stores/docConfig.ts` (Pinia): `documentTypes`, `templatesByType`, `fieldsByTemplate`, `mappings`, `workflows`, `departments`, `roles`, `loading`, `error`; loaders + mutation wrappers that refresh; capture errors.

## 6. View & shell

- [x] 6.1 `views/admin/DocConfigView.vue` with `Tabs`: Document Types (table + create/edit dialog), Forms (type → templates → fields, with New template / Add field / Publish), Mappings (table + New mapping dialog), Workflows (table + New workflow / Add step dialog). Manage gated by `can('DOC_CONFIG_MANAGE')`; workflow writes also by `can('WORKFLOW_MANAGE')`.
- [x] 6.2 Dialogs use `<Form :resolver="zodResolver(schema)">` + `<FormField>` + `<Message>` with the shared schemas; category/field-type/approve-mode/post-action/department/role/template/workflow `Select`s.
- [x] 6.3 Routing + nav: route `doc-config` (`meta.permission='DOC_CONFIG_MANAGE'`); a "Configuration" nav item gated by `can('DOC_CONFIG_MANAGE')`.

## 7. Frontend tests

- [x] 7.1 doc-config store (mock `api`): loaders populate document types / templates / fields / mappings / workflows; `createDocumentType`/`addField`/`createMapping`/`addStep` call the right endpoint and refresh; error captured.
- [x] 7.2 Shared schemas: valid type/field/mapping/workflow-step accepted; missing required and a bad category / approve mode / field type rejected.

## 8. Verify

- [x] 8.1 `pnpm --filter @erp/shared build`, `pnpm --filter back build` + `pnpm --filter back test`, `pnpm --filter front-end build` + `pnpm --filter front-end test` pass.
- [x] 8.2 Run `openspec validate web-doc-config --type change --strict`.
