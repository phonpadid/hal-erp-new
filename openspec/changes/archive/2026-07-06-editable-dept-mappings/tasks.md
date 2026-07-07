## 1. Shared schema

- [x] 1.1 Add `deptDocTypeUpdateSchema` to `@erp/shared` (`shared/src/index.ts`): optional
  `workflowId` (uuid), `formTemplateId` (uuid), `isActive` (boolean); export
  `DeptDocTypeUpdateInput`. Mirror the existing create shape.
- [x] 1.2 Rebuild the shared package so backend and frontend pick up the new export.

## 2. Backend — DTO + service

- [x] 2.1 Add `UpdateDeptDocTypeDto` (`dto/config.dto.ts`) with class-validator: optional
  `@IsUUID` `workflowId`/`formTemplateId`, optional `@IsBoolean` `isActive`.
- [x] 2.2 Extract the create-time template checks (exists, belongs to the document type, not
  `RETIRED`) into a private helper in `DeptDocTypeService`.
- [x] 2.3 `DeptDocTypeService.create`: pre-check for an existing `(department, documentType)`
  row and throw `ConflictException` (→ 409); wrap the flush so a unique-violation race also
  maps to 409, not 500.
- [x] 2.4 Add `DeptDocTypeService.update(id, dto)`: resolve the mapping scoped to the active
  company (not found otherwise), apply the shared template validation against the mapping's
  own document type, set `workflow`/`formTemplate`/`isActive` from provided fields, flush.

## 3. Backend — controller

- [x] 3.1 Add `@Patch('dept-doc-types/:id')` to `document-config.controller.ts` with
  `ParseUUIDPipe` on `:id`, `@RequirePermissions(DOC_CONFIG_MANAGE)`, delegating to
  `update`.

## 4. Backend — tests

- [x] 4.1 Unit test: update repoints a mapping's workflow; a document created afterward
  resolves the new workflow while an in-flight document keeps its original (company-scoped).
- [x] 4.2 Unit test: duplicate create returns 409 (not 500); update with a mismatched or
  `RETIRED` template is rejected and leaves the row unchanged.
- [x] 4.3 Unit test: updating a mapping that belongs to another company is not found.

## 5. Frontend — api + store + schema

- [x] 5.1 Add `updateMapping(id, dto)` to the docConfig api client (`api/docConfig.ts`,
  `PATCH /document-config/dept-doc-types/:id`) and a store action in `stores/docConfig.ts`.
- [x] 5.2 Wire the shared `deptDocTypeUpdateSchema` into the mapping form's `zodResolver`.

## 6. Frontend — Dept Mappings edit UI

- [x] 6.1 Add a per-row **Edit** action in `DeptMappingsView.vue` opening the mapping form
  pre-filled, with department and document type shown read-only; save calls `updateMapping`.
- [x] 6.2 Surface a 409 conflict from create/update as a clear message (toast/field), and note
  in the dialog that repointing affects only future documents.
- [x] 6.3 Component test: editing a mapping's workflow calls `updateMapping` and reflects the
  new workflow in the list; a 409 shows the conflict message.

## 7. Verify

- [x] 7.1 Run backend specs (`vitest`) and frontend component tests; typecheck both packages.
- [x] 7.2 Manually confirm the original failure is fixed: editing the `(Procurement, PR)`
  mapping to "Full Approval Chain" succeeds via the UI, and a repeat create of the same pair
  returns a clear 409.
