## MODIFIED Requirements

### Requirement: Versioned Forms
The system SHALL version form templates; a document MUST retain the
`form_template_id` it was created with, even after the template is revised. A form template
SHALL be mutable only while its `status` is `DRAFT`: once `PUBLISHED` (and likewise once
`RETIRED`), the system SHALL reject adding or editing its `form_field` rows, so further changes
MUST be made on a new version. The system SHALL support a `PUBLISHED → RETIRED` transition.

#### Scenario: Old document keeps its form version
- GIVEN a document created on form template version 1
- WHEN the template is published as version 2
- THEN reopening the old document still renders version 1 fields

#### Scenario: Editing a published template is rejected
- GIVEN a form template whose `status` is `PUBLISHED`
- WHEN a `DOC_CONFIG_MANAGE` user tries to add or edit a `form_field` on it
- THEN the request is rejected with a conflict error and no `form_field` row is written

#### Scenario: Changes go to a new version
- GIVEN a `PUBLISHED` template for a document type
- WHEN the user creates a new template for that type
- THEN it is created as the next `version` with `status` `DRAFT` and is independently editable

#### Scenario: Retire a published template
- GIVEN a `PUBLISHED` template
- WHEN a `DOC_CONFIG_MANAGE` user retires it
- THEN its `status` becomes `RETIRED` and it can no longer be selected for new mappings

### Requirement: Attachments on External Storage
The system SHALL store attachment metadata in `document_attachment` and keep file
bytes on external object storage (S3/MinIO), never in the database. The system SHALL issue a
short-lived presigned **upload** URL so the browser PUTs bytes directly to the bucket, and a
short-lived presigned **download** URL for retrieval; only the returned object key, file name,
size, and mime type SHALL be persisted in `document_attachment` (`file_path` holds the key). The
system SHALL list a document's attachments, scoped to the active company.

#### Scenario: Attach a receipt
- GIVEN a user uploads a PDF receipt to a document
- WHEN the upload completes
- THEN `document_attachment` stores the path, size, and mime type only

#### Scenario: Presigned upload URL is issued
- GIVEN a `DOC_CREATE` user requests to upload a file to their document
- WHEN they request a presigned upload URL
- THEN the system returns a short-lived URL and object key, and the file bytes never pass through the API

#### Scenario: Presigned download URL is issued
- GIVEN a registered `document_attachment`
- WHEN a `DOC_VIEW` user requests its download URL
- THEN the system returns a short-lived presigned GET URL for the stored object key

#### Scenario: List a document's attachments
- WHEN a `DOC_VIEW` user lists a document's attachments
- THEN the active company's `document_attachment` rows for that document are returned (name, size, mime, uploader)

### Requirement: Document Reference Chain
The system SHALL allow a document to reference a predecessor via `ref_document_id`
(e.g. PO references PR, advance-clearing references advance). When `ref_document_id` is set, the
system SHALL resolve the predecessor **within the active company** — a predecessor belonging to
another company SHALL resolve as not-found — SHALL require the predecessor's `status` to be
`APPROVED` or `COMPLETED`, and SHALL require the predecessor-type → new-type pairing to be
permitted by configuration (not hardcoded per type). The system SHALL provide a
create-from-predecessor action that issues a `DRAFT` of the target type with header fields and
`document_line` rows copied from the predecessor; the copy SHALL NOT create budget or quota holds.

#### Scenario: PO links to its PR
- GIVEN an approved PR
- WHEN a PO is created from it
- THEN the PO's `ref_document_id` points to the PR

#### Scenario: Create-from copies header and lines
- GIVEN an `APPROVED` predecessor with multiple `document_line` rows
- WHEN a user creates a successor from it
- THEN a `DRAFT` successor is created with the header fields and lines copied, and no `budget_txn` or `quota_usage` rows are written

#### Scenario: Referencing an unapproved predecessor is rejected
- GIVEN a predecessor whose `status` is `DRAFT` or `SUBMITTED`
- WHEN a document is created referencing it
- THEN the request is rejected with a validation error

#### Scenario: Cross-company predecessor is not-found
- WHEN a user references a predecessor `:id` that belongs to a different company
- THEN the request resolves as not-found (404) and no `document` is created

#### Scenario: Disallowed type pairing is rejected
- GIVEN configuration that does not permit the predecessor-type → target-type pairing
- WHEN a create-from is attempted across that pairing
- THEN the request is rejected with a validation error

### Requirement: Document Submit Lifecycle

On submit the system SHALL, in a single transaction: validate that every required **and visible**
`form_field` has a value — a field whose `condition_json` evaluates to hidden is neither required
nor persisted; resolve and **lock** the FX rate at the submit date, stamping `exchange_rate`,
`base_total_amount`, and each line's `base_line_amount`; reject the submit if the document's date
falls in a CLOSED fiscal period; reject any vendor or item not enabled for the active company; and
then transition the document from `DRAFT` to `SUBMITTED`. If any step fails, no holds are created
and the document stays `DRAFT`.

#### Scenario: Submit locks the FX rate and base amounts

- **WHEN** a foreign-currency document is submitted
- **THEN** `exchange_rate` and `base_total_amount` are stamped from the rate resolved at
  the submit date, and a later rate change does not alter them

#### Scenario: Missing required field blocks submit

- **GIVEN** a required `form_field` with no `doc_field_value`
- **WHEN** the document is submitted
- **THEN** submission is rejected and the document remains `DRAFT`

#### Scenario: Hidden required field does not block submit

- **GIVEN** a required `form_field` whose `condition_json` evaluates to hidden for the document's values
- **WHEN** the document is submitted without a value for that field
- **THEN** submission is not blocked by that field and any stored value for it is ignored

#### Scenario: Submit into a closed period is rejected

- **WHEN** a budget-consuming document dated in a CLOSED fiscal year is submitted
- **THEN** submission is rejected with a closed-period error

## ADDED Requirements

### Requirement: Conditional Field Visibility

The system SHALL evaluate a `form_field`'s `condition_json` to determine whether the field is
visible for a given set of `doc_field_value`s, using a single deterministic rule shape shared by
the client renderer and the server submit check so the two cannot drift. A `null`/absent
`condition_json` means always visible; otherwise the rule references another field on the same
template by `field_name` with a finite operator set (e.g. `eq`, `ne`, `in`, `nin`, `empty`,
`notEmpty`). Visibility SHALL govern both client rendering and the server's required-field
enforcement (see Document Submit Lifecycle).

#### Scenario: Field shown when condition is met
- GIVEN field B with `condition_json` requiring field A `eq` "Yes"
- WHEN field A's value is "Yes"
- THEN field B is visible and, if required, its value is enforced at submit

#### Scenario: Field hidden when condition is not met
- GIVEN field B with `condition_json` requiring field A `eq` "Yes"
- WHEN field A's value is "No"
- THEN field B is hidden and not required at submit

### Requirement: Form Field Type Validation

The system SHALL validate a `form_field`'s `field_type` against the allowed set
(`text`, `number`, `date`, `dropdown`, `file`, `line_items`) and SHALL reject any other value. A
`dropdown` field SHALL carry its choices in `options_json`. A `line_items` field SHALL denote that
the document captures `document_line` rows (stored via the lines endpoint, not in
`doc_field_value`); a `file` field SHALL denote attachment capture into `document_attachment`.

#### Scenario: Unknown field type is rejected
- WHEN a `DOC_CONFIG_MANAGE` user adds a `form_field` with a `field_type` outside the allowed set
- THEN the request is rejected with a validation error and no `form_field` row is written

#### Scenario: Dropdown carries options
- WHEN a `dropdown` field is created with `options_json`
- THEN the field is stored with its choices and the form read returns them for rendering

### Requirement: Document Detail Read Surface

The system SHALL return, for a single document read scoped to the active company, the document
header together with its `doc_field_value` values, its `document_line` rows, its
`document_attachment` metadata, and its predecessor reference (`ref_document_id` with the
predecessor's `doc_no`/`status`) so the client can render the full document.

#### Scenario: Detail returns fields, lines, attachments, and predecessor
- GIVEN a document with field values, lines, attachments, and a `ref_document_id`
- WHEN a `DOC_VIEW` user reads it within the active company
- THEN the response includes the field values, line items, attachment metadata, and the predecessor's `doc_no` and `status`

#### Scenario: Reading another company's document is not-found
- WHEN a user reads a document `:id` that belongs to a different company
- THEN the request resolves as not-found (404)
