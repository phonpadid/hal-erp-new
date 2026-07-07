## 1. Shared schema + condition evaluator

- [x] 1.1 Add the `field_type` enum (`text`/`number`/`date`/`dropdown`/`file`/`line_items`), `options_json`, and `condition_json` to the shared `form_field` Zod schema in `shared/src/index.ts`.
- [x] 1.2 Define the `condition_json` shape (`{ field, op: eq|ne|in|nin|empty|notEmpty, value }`) as a shared Zod schema/type.
- [x] 1.3 Implement and unit-test a pure `isFieldVisible(field, values)` evaluator in `shared/` (fail-open on unresolved reference), exported for both backend and frontend.
- [x] 1.4 Add a shared schema/type for the create-from-predecessor payload.

## 2. Backend — form template immutability & lifecycle

- [x] 2.1 In `form-template.service.ts`, guard `addField` (and any field edit) to throw `ConflictException` when the template `status` is not `DRAFT`.
- [x] 2.2 Add a `retire` transition (`PUBLISHED → RETIRED`) with a `DOC_CONFIG_MANAGE` endpoint, and exclude `RETIRED` templates from mapping selection.
- [x] 2.3 Validate `field_type` against the allowed set in `CreateFormFieldDto` (and require `options_json` shape for `dropdown`); reject unknown types.
- [x] 2.4 Unit tests: editing a published template is rejected; retire transition; unknown field type rejected; dropdown options round-trip.

## 3. Backend — conditional field evaluation at submit

- [x] 3.1 In `document-submit.service.ts`, load each required field's `condition_json` and use the shared `isFieldVisible` against the document's values; enforce required only when visible.
- [x] 3.2 Drop/ignore stored `doc_field_value`s whose field is hidden before persistence/validation.
- [x] 3.3 Unit tests: hidden required field does not block submit; visible required field still blocks when empty.

## 4. Backend — attachment storage (S3/MinIO presigned)

- [x] 4.1 Add `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` and a `StorageService` configured via env (endpoint, bucket, creds, `forcePathStyle`).
- [x] 4.2 Add `POST /documents/:id/attachments/presign-upload` (`DOC_CREATE`) returning a short-lived presigned PUT URL + object key, scoped to the active company.
- [x] 4.3 Add `GET /documents/:id/attachments` (`DOC_VIEW`) listing metadata, and `GET /documents/:id/attachments/:attId/download-url` (`DOC_VIEW`) returning a presigned GET URL.
- [x] 4.4 Keep `POST /documents/:id/attachments` registering metadata only (`file_path` = object key); validate UUID params and company scope.
- [x] 4.5 Unit tests: presign endpoints issue URLs without bytes hitting the API; cross-company `:id` resolves not-found; register stores key + metadata only.

## 5. Backend — reference chain validation & create-from

- [x] 5.1 On `createDraft`, when `refDocumentId` is set, resolve the predecessor within the active company (cross-company → `NotFoundException`), require status ∈ {`APPROVED`,`COMPLETED`}, and validate the predecessor-type → target-type pairing against configuration (`document_type` config field per design D4).
- [x] 5.2 Add `POST /documents/from/:refId` (`DOC_CREATE`) that issues a `DRAFT` of the target type copying header fields + `document_line` rows from the predecessor, sets `ref_document_id`, and creates no budget/quota holds. Reuse the locked numbering path.
- [x] 5.3 Populate the single-document read with field values, lines, attachment metadata, and the predecessor reference (`doc_no`, `status`).
- [x] 5.4 Unit tests: unapproved predecessor rejected; cross-company predecessor not-found; disallowed pairing rejected; create-from copies header+lines and writes no `budget_txn`/`quota_usage`.
- [x] 5.5 Concurrency test: create-from issues a unique sequential `doc_no` under the existing `doc_running_number` pessimistic lock when run concurrently.

## 6. Frontend — form builder (web-doc-config)

- [x] 6.1 Extend the field dialog in `views/admin/DocConfigView.vue` to cover all field types and an `options_json` editor for `dropdown`.
- [x] 6.2 Add a `condition_json` rule builder (target field + operator + value) bound to the shared schema.
- [x] 6.3 Add field reordering (update `sort_order`) and a template "Retire" action; reflect immutability of published templates in the UI.
- [x] 6.4 Add inline edit for document types and department mappings.

## 7. Frontend — form rendering & utilities

- [x] 7.1 Extend `utils/formFields.ts` to render `dropdown` (from `options_json`) and `file` field types.
- [x] 7.2 Wire the shared `isFieldVisible` evaluator so configured fields show/hide live as values change.

## 8. Frontend — document create/edit (web-documents)

- [x] 8.1 Add a draft edit route `/documents/:id/edit` and load existing field values + lines into the editor.
- [x] 8.2 Add line-row delete and numeric validation (qty/unitPrice) to the line-item editor.
- [x] 8.3 Implement file upload via presigned URL (PrimeVue FileUpload): request URL → PUT to bucket → register metadata.
- [x] 8.4 Add the create-from-predecessor flow: a predecessor picker and a "Create from" action; surface server rejections.

## 9. Frontend — document detail (web-documents)

- [x] 9.1 Render saved field values and line items in `views/documents/DocumentDetailView.vue`.
- [x] 9.2 Render the attachment list with presigned download links.
- [x] 9.3 Render the predecessor reference as a link to the source document.

## 10. Config / infra / verification

- [x] 10.1 Document and configure the S3/MinIO bucket + credentials and the bucket CORS rule for direct browser upload; set presigned URL TTL and max attachment size.
- [x] 10.2 Run `openspec validate complete-configurable-documents`; run backend Vitest and frontend type-check; manual smoke of build → publish form with a conditional field → create doc with dropdown/file/conditional → create-from predecessor.
