## Why

The Configurable Documents capability (feature 5: ประเภทเอกสารและฟอร์ม) is ~70% built:
the data model, document-type flags, versioned `form_template`/`form_field`, per-department
mapping (`dept_doc_type`), multi-line items, locked per-company/type/year numbering, and the
configuration + end-user CRUD endpoints all exist. But several promised behaviors are
declared in the schema yet never wired end-to-end, so the feature cannot actually be used as
specified:

- **Conditional fields** (`condition_json`) are stored but never evaluated — neither at
  render nor at submit, so "show/hide fields by condition" does nothing.
- **Form templates are not immutable after publish** — `addField` accepts new fields on a
  `PUBLISHED` template, which silently breaks the "old documents keep their version" guarantee.
- **Attachments are metadata-only** — there is no S3/MinIO upload/download path, so users
  cannot actually attach files (invariant: bytes live on external storage, never the DB).
- **The reference chain is unsafe and invisible** — `ref_document_id` is accepted without any
  validation (cross-company, predecessor status, allowed type) and there is no PR→PO /
  advance→clear "create-from" flow or UI.
- **The document detail view shows neither field values, line items, nor attachments**, and
  drafts cannot be reopened/edited — so a created document is effectively write-only.
- **`dropdown`, `file`, and `line_items` field types** are unsupported in the form builder and
  the renderer, and there is no editor for `options_json`.

This change closes those gaps so the feature matches its specs.

## What Changes

**Backend (document-engine)**
- Reject mutations (`addField`, field edits) to a `PUBLISHED`/`RETIRED` form template; further
  changes MUST go to a new version. Add a `RETIRED` lifecycle transition.
- Evaluate `condition_json` server-side at submit so a required field is only enforced when its
  visibility condition is met (required-when-visible); persisted values for hidden fields are ignored.
- Validate `field_type` against the allowed set (`text`/`number`/`date`/`dropdown`/`file`/`line_items`).
- Add attachment storage: issue presigned S3/MinIO **upload** and **download** URLs; the existing
  register endpoint records returned metadata only. Add attachment listing on a document.
- Validate `ref_document_id` on create (same company, predecessor is `APPROVED`/`COMPLETED`, and the
  predecessor→successor type pairing is allowed) and add a **create-from-predecessor** action that
  copies header/lines from the source document (PR→PO, advance→clear-advance).
- Surface `ref_document`, field values, line items, and attachments on the document detail read.

**Frontend (web-doc-config — Form Builder)**
- Field dialog gains `options_json` editor (dropdown choices) and a `condition_json` rule builder
  (field/operator/value), plus support for `file` and `line_items` field types and field reordering.
- Inline edit for document types and department mappings.

**Frontend (web-documents — end-user screens)**
- Detail view renders field values, line items, attachments, and the predecessor reference link.
- Reopen/edit a draft (`/documents/:id/edit`).
- Render `dropdown` and `file` field types; evaluate `condition_json` to show/hide fields live.
- File attachment upload via presigned URL (PrimeVue FileUpload) in create/edit/detail.
- Line-item editor: delete rows and numeric validation.
- "Create from" / predecessor picker for the reference chain (PR→PO, advance→clear).

**Shared**
- Extend the shared form-field/document Zod schemas with `options_json`, `condition_json`, the full
  `field_type` enum, and the create-from payload, keeping client and server validation in sync.

No new tables — all changes use the existing DBML (`form_field.condition_json`,
`form_field.options_json`, `document.ref_document_id`, `document_attachment`).

## Capabilities

### New Capabilities
<!-- None — all behavior extends existing capabilities. -->

### Modified Capabilities
- `document-engine`: form-template immutability after publish; conditional-field evaluation at
  submit (required-when-visible); `field_type` validation; presigned attachment upload/download +
  listing; reference-chain validation and create-from-predecessor; detail read surface includes
  field values, lines, attachments, and predecessor reference.
- `web-doc-config`: form builder gains `options_json` editor, `condition_json` rule builder,
  `file`/`line_items` field types, field reorder, and inline edit of types and mappings.
- `web-documents`: detail renders field values/lines/attachments/predecessor; draft edit route;
  `dropdown`/`file` rendering with live conditional show/hide; presigned attachment upload;
  line-row delete + validation; create-from-predecessor flow.

## Impact

- **Backend:** `back/src/modules/document/` — `form-template.service.ts` (publish/immutability,
  retire), `document-submit.service.ts` (condition evaluation), `attachment.service.ts` +
  `document.controller.ts` (presign endpoints, listing), `document.service.ts` (ref validation,
  create-from, detail population), `dto/config.dto.ts` + `dto/document.dto.ts`, new unit tests.
  Adds an S3/MinIO client dependency (e.g. `@aws-sdk/client-s3` + presigner) and config.
- **Invariants:** preserves all eight. Particularly invariant 7 (configuration over code — no
  per-type branching; behavior stays in `document_type`/`form_field`/`workflow`), company
  isolation (ref-chain validation enforces same-company; cross-company predecessor → not-found),
  and "bytes never in the DB" (presigned external storage only). Append-only ledgers untouched.
- **Frontend:** `front-end/src/views/admin/DocConfigView.vue`,
  `front-end/src/views/documents/*` (Create/Detail/My + new Edit), `front-end/src/utils/formFields.ts`,
  `front-end/src/api/documents.ts` + `docConfig.ts`.
- **Shared:** `shared/src/index.ts` Zod schemas.
- **Config/Infra:** S3/MinIO bucket + credentials; CORS for direct browser upload to the bucket.
