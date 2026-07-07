## MODIFIED Requirements

### Requirement: Document List and Detail

The web app SHALL show the active company's documents (with status) to users holding
`DOC_VIEW`, and a detail view with the document's header, field values, line items,
attachments, approval log, and — when present — its predecessor reference (the source
document's `doc_no`, linked). Attachments SHALL be downloadable via a server-issued presigned
URL. Reads are scoped to the active company by the server.

#### Scenario: List shows the company's documents

- **WHEN** a user with `DOC_VIEW` opens the documents list
- **THEN** the active company's documents are shown with their status

#### Scenario: Detail renders fields and lines

- **WHEN** the user opens a document
- **THEN** its header, field values, line items, and approval log are displayed

#### Scenario: Detail shows attachments and predecessor

- **WHEN** the user opens a document that has attachments and a predecessor reference
- **THEN** the attachment list (with download links) and a link to the predecessor document are displayed

### Requirement: Create and Edit a Draft

The web app SHALL let a `DOC_CREATE` user create a document of a type enabled for their
department, rendering the form dynamically from the type's `form_field` configuration (not
hardcoded), and SHALL let the user reopen and edit an existing draft. Rendering SHALL cover all
field types including `dropdown` (from `options_json`) and `file`, and SHALL evaluate each field's
`condition_json` to show or hide it live as other field values change. The line-item editor SHALL
support adding and deleting rows with numeric validation of quantity and price. A `file` field SHALL
upload attachments via a server-issued presigned URL (bytes go directly to storage), registering
only metadata. Required fields SHALL be validated client-side before save (the server remains
authoritative).

#### Scenario: Form is rendered from configuration

- **WHEN** the user picks a creatable document type
- **THEN** the form fields shown come from that type's template configuration

#### Scenario: Required field blocks save

- **WHEN** the user tries to save with a required field empty
- **THEN** the client shows a validation error and does not submit

#### Scenario: Conditional field shows and hides live

- **WHEN** the user changes a value that another field's `condition_json` depends on
- **THEN** the dependent field appears or disappears without a page reload

#### Scenario: Dropdown renders its options

- **WHEN** a `dropdown` field is rendered
- **THEN** its choices come from the field's `options_json`

#### Scenario: Upload an attachment

- **WHEN** the user selects a file on a `file` field
- **THEN** the file is uploaded directly to storage via a presigned URL and its metadata is registered on the document

#### Scenario: Delete a line item

- **WHEN** the user removes a line in the line-item editor
- **THEN** that line is removed before save

#### Scenario: Reopen and edit a draft

- **WHEN** a `DOC_CREATE` user opens one of their drafts to edit
- **THEN** its current field values and lines load into the editor and can be changed and saved

## ADDED Requirements

### Requirement: Create Document from Predecessor

The web app SHALL let a `DOC_CREATE` user create a document from an eligible predecessor (e.g.
PR→PO, advance→clear-advance), choosing the predecessor and producing a draft seeded with the
copied header and line items. The affordance SHALL be shown only where permitted and the
predecessor picker SHALL list only documents the user may reference.

#### Scenario: Create-from seeds a draft

- **WHEN** the user creates a document from an approved predecessor
- **THEN** a draft opens pre-filled with the predecessor's copied header fields and line items, with its reference set

#### Scenario: Server rejection is surfaced

- **WHEN** the server rejects the create-from (e.g. predecessor not approved or disallowed pairing)
- **THEN** the error is shown and no draft is created
