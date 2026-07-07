## Context

The document engine already exists end-to-end at a CRUD level (see archived
`implement-document-engine`, `web-doc-config`, `web-documents`). The data model in
`erp_approval_system.dbml` reserves columns for the remaining behavior —
`form_field.condition_json`, `form_field.options_json`, `document.ref_document_id`,
`document_attachment.file_path` — but those columns are inert: stored, never acted on. This
change makes the declared-but-dormant behavior real, plus the matching UX. No schema change is
needed, so there is no migration of existing rows.

Constraints that shape the design:
- **Invariant 7 (configuration over code):** behavior must stay data-driven. Conditional
  visibility, field types, and the predecessor→successor pairing must be expressed in
  configuration (JSON columns / `document_type`), not in per-type `if` branches.
- **Invariant 1 (company isolation):** the reference chain must never let a document point at
  another company's document; cross-company `:id` resolves as not-found.
- **Bytes never in the DB:** attachments must transit directly between browser and S3/MinIO.

## Goals / Non-Goals

**Goals:**
- Server enforces form-template immutability after publish and a `RETIRED` transition.
- Server evaluates `condition_json` at submit (required-when-visible) and ignores values for
  hidden fields, using one shared evaluator with the frontend.
- Real attachment upload/download via presigned S3/MinIO URLs; DB stores metadata only.
- Reference chain is validated (same company, predecessor status/type) and supports a
  create-from-predecessor copy (PR→PO, advance→clear-advance).
- Detail read returns field values, lines, attachments, and predecessor reference; the web
  detail and a new draft-edit screen render them; the form builder edits `options_json` and
  `condition_json` and supports `file`/`line_items` field types.

**Non-Goals:**
- No change to budget/quota reservation math, the approval workflow engine, or numbering.
- No rich rule language — `condition_json` is a small, finite operator set, not an expression VM.
- No document deletion, no attachment virus scanning, no PDF generation.
- No new tables or columns.

## Decisions

### D1 — `condition_json` shape: a small declarative rule, evaluated by one shared function
A field's `condition_json` is `null` (always visible) or `{ "field": "<fieldName>", "op":
"eq|ne|in|nin|empty|notEmpty", "value": <scalar|array> }`, referencing another field on the
same template by `field_name`. A single pure evaluator `isFieldVisible(field, values)` lives in
`shared/` and is imported by both the Vue renderer and the Nest submit service, so client UX and
server enforcement cannot drift. At submit, a required field is enforced **only when visible**;
values whose field is not visible are dropped before persistence.
- *Alternatives:* a JS expression string (rejected — unsafe to eval, hard to validate, drifts);
  multi-condition AND/OR trees (deferred — start with one condition, the column is text so the
  shape can grow without migration).

### D2 — Immutability enforced in the service, keyed on template `status`
`FormTemplateService.addField` (and any field edit) loads the template and throws
`ConflictException` if `status !== 'DRAFT'`. `publish` is DRAFT→PUBLISHED; a new `retire` is
PUBLISHED→RETIRED. Versioning already exists (`createTemplate` picks next version), so "edit a
published form" naturally becomes "create v+1". Documents pin `form_template_id` at create, so
old documents keep rendering their original version regardless.
- *Alternative:* DB trigger/immutability at the row level — rejected as harder to message back
  to the user and redundant with the service guard.

### D3 — Presigned URLs, browser uploads direct to S3/MinIO
Three-step flow: (1) `POST /documents/:id/attachments/presign-upload` returns a presigned PUT
URL + the object key; (2) the browser PUTs the file bytes straight to the bucket; (3) the
existing `POST /documents/:id/attachments` registers `{ fileName, filePath=key, fileSizeKb,
mimeType }`. Download is `GET /documents/:id/attachments/:attId/download-url` → short-lived
presigned GET. The DB only ever holds the key + metadata. A thin `StorageService` wraps
`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, configured for MinIO via env
(endpoint, bucket, credentials, `forcePathStyle`).
- *Alternative:* stream bytes through the API — rejected (API memory/CPU, and violates the
  "external storage" intent; large files would bloat the request path).

### D4 — Reference chain validated at create; create-from copies header + lines
On create, if `ref_document_id` is set, the service resolves it **within the active company**
(cross-company → `NotFoundException`), requires its status ∈ {`APPROVED`,`COMPLETED`}, and
checks the predecessor's `document_type.code` → new `document_type.code` pairing against an
allow-list expressed in configuration (a `ref_from` list on `document_type`, parsed from a JSON
column already available as text, or a static config map seeded per deployment — see Open
Questions). A new `POST /documents/from/:refId` issues a draft of the target type with header
fields and `document_line` rows copied from the predecessor (qty/price/budget retained), leaving
amounts to be re-confirmed at submit. The copy does **not** create budget/quota holds.
- *Alternative:* free-form references with no validation (current state) — rejected: violates
  company isolation and lets unapproved/garbage predecessors link.

### D5 — `line_items` and `file` are field types, but reuse existing storage
`line_items` as a form field is a *marker* that the document captures `document_line` rows
(persisted via the existing `PUT /:id/lines`), not a new value store — `doc_field_value` stays
scalar. `file` as a field type renders the attachment uploader bound to the document. This keeps
`document_line` and `document_attachment` as the single homes for lines and files while letting
the builder place them in form order.

## Risks / Trade-offs

- **Condition references a renamed/removed field** → evaluator treats an unresolved reference as
  "visible" (fail-open for display) but the builder validates references at field-save time, and
  publish blocks dangling references, so a published template can't ship a broken condition.
- **Direct browser→bucket upload needs CORS** → document the required MinIO/S3 bucket CORS rule;
  presigned URLs are short-lived (e.g. 5 min) to limit exposure.
- **Orphaned objects** (presigned-uploaded bytes never registered) → acceptable; a later
  lifecycle/cron sweep can reap unregistered keys. Out of scope here.
- **Create-from copies a stale predecessor** (budgets/FX changed since) → amounts and FX are
  re-resolved at the successor's own submit (FX locked then per invariant 6), so the copy is a
  convenience seed, not an authoritative snapshot.
- **Shared evaluator coupling** → both runtimes import one function; a change must keep the JSON
  shape backward-compatible (text column tolerates additive fields).

## Migration Plan

1. Ship `StorageService` + env config (S3/MinIO endpoint, bucket, creds, CORS) — inert until used.
2. Backend: immutability guard, condition evaluator (shared), submit integration, ref validation,
   create-from, presign endpoints, enriched detail read. Add unit + concurrency-safe tests.
3. Shared Zod schema updates (additive — no client break).
4. Frontend: builder editors, renderer (dropdown/file/conditional), detail render, draft edit,
   upload, create-from.

No data migration (columns already exist, all additions are additive). **Rollback:** feature is
additive; reverting the service guards/endpoints restores prior behavior. Existing documents are
unaffected because none of the dormant columns were previously populated with active rules.

## Open Questions

- **Predecessor→successor allow-list source:** add a `ref_from` JSON field on `document_type`
  (config-driven, preferred per invariant 7) versus a seeded static map? Leaning to a config
  field so admins define PR→PO without code, decided at apply time.
- **Presigned URL TTL** and max attachment size — pick deployment defaults (proposed: 5 min, 25 MB).
- **`condition_json` multi-condition** (AND/OR) — ship single-condition now; revisit if needed.
