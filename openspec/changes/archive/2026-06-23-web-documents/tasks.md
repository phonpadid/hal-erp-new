## 1. Backend: requester-facing creation reads (document-engine)

- [x] 1.1 `DocumentService.listCreatableTypes()`: active department's `dept_doc_type` (active) → `[{ id, code, name, requiresBudget, requiresQuota }]`.
- [x] 1.2 `DocumentService.formForType(documentTypeId)`: resolve the active dept's mapping for the type (reject if unmapped) → `{ documentTypeId, formTemplateId, version, fields: [{ id, fieldName, fieldLabel, fieldType, isRequired, sortOrder }] }` (ordered).
- [x] 1.3 `DocumentController`: `GET /documents/creatable-types` and `GET /documents/types/:id/form` (both `@RequirePermissions('DOC_CREATE')`, `ParseUUIDPipe` on `:id`); place before `GET /documents/:id` so paths don't collide.
- [x] 1.4 Backend tests (DB-backed): seed a dept→type mapping with a required field; assert `listCreatableTypes` includes it and `formForType` returns the field; an unmapped type is rejected.

## 2. Frontend data layer

- [x] 2.1 `api/documents.ts`: typed wrappers — `list`, `get(id)`, `creatableTypes`, `formForType(id)`, `create(dto)`, `setFields(id, values)`, `setLines(id, lines)`, `submit(id, body?)`, `cancel(id)`, `attach(id, meta)`, `approvalLog(id)`. Amounts as strings.
- [x] 2.2 `stores/documents.ts` (Pinia): `list`, `current`, `loading`, `error`; actions `loadList`, `loadOne`, `createDraft`, `saveContent`, `submit`, `cancel` (capture server error messages).
- [x] 2.3 `utils/form.ts`: pure `validateRequired(fields, values)` → list of missing required field names; `lineAmount(qty, unitPrice)` string math helper.

## 3. Views

- [x] 3.1 `views/documents/MyDocumentsView.vue`: table of the company's documents (doc_no, type, status chip, total, created), status filter, row → detail; "New" button gated by `can('DOC_CREATE')`.
- [x] 3.2 `views/documents/DocumentDetailView.vue`: header + rendered field values + line items + attachments + approval-log timeline; Submit/Cancel buttons gated by `can()` + status; server-error banner.
- [x] 3.3 `views/documents/CreateDocumentView.vue`: type picker (`creatableTypes`) → dynamic form from `formForType` (input per `fieldType`, required marked) → line editor (description/qty/unitPrice/lineAmount; budget Select when `can('BUDGET_VIEW')`; item Select when `can('MASTER_VIEW')`) → Save draft, then Submit. Client-side required validation before save.

## 4. Routing & shell

- [x] 4.1 Routes under the shell: `documents` (`meta.permission='DOC_VIEW'`), `documents/new` (`DOC_CREATE`), `documents/:id` (`DOC_VIEW`); make `documents` the post-login home.
- [x] 4.2 Add a "Documents" nav item in `AppShell` gated by `can('DOC_VIEW')`; drop the sample company form from nav.

## 5. Frontend tests

- [x] 5.1 Documents store (mock `api`): `loadList` populates list; `createDraft` returns an id; `submit` success updates status; a rejected `submit` captures the server error message.
- [x] 5.2 `validateRequired` helper: missing required → reports the field; all present → empty; `lineAmount` computes qty×unitPrice exactly.

## 6. Verify

- [x] 6.1 `pnpm --filter back build` + `pnpm --filter back test` and `pnpm --filter front-end build` + `pnpm --filter front-end test` pass.
- [x] 6.2 Run `openspec validate web-documents --strict`.
