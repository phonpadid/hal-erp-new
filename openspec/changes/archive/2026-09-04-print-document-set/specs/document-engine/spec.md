## ADDED Requirements

### Requirement: A Document Type Declares Which Sheets It Prints

`document_type` SHALL carry a `print_templates` column naming the printed sheets a document of
that type produces: an ordered, non-empty list drawn from the closed set `LETTER` / `PR` / `PO` /
`RECEIPT`, defaulting to `LETTER`, so existing types keep printing exactly what they print today.
A type MAY declare several sheets, and the system SHALL store them in print order regardless of
the order they were given in — one document can be several pieces of paper. Every entry SHALL be
validated on create and update, and a value outside the set SHALL be rejected rather than stored,
as SHALL an empty list. Like every other type flag it is owned per company (invariant 1) and is
configuration, not code: the printed sheets SHALL NOT be derived from `code`, `category` or
`post_action` (invariant 7). Several active types of one company MAY declare the same sheets.

#### Scenario: An existing type defaults to the letter

- **GIVEN** a document type created before this change
- **WHEN** it is read after the migration
- **THEN** its `print_templates` is `LETTER`

#### Scenario: A type prints several sheets, in print order

- **WHEN** a `DOC_CONFIG_MANAGE` user configures a type with the purchase-request sheet and the
  official letter, in that order
- **THEN** the type is stored as `LETTER,PR` and prints the letter before the request form

#### Scenario: An unknown template value is refused

- **WHEN** a `DOC_CONFIG_MANAGE` user sets a type's `print_templates` to a list containing a value
  outside the closed set
- **THEN** the update is rejected and the stored value is unchanged

#### Scenario: An empty list is refused

- **WHEN** a `DOC_CONFIG_MANAGE` user sets a type's `print_templates` to an empty list
- **THEN** the update is rejected: every document prints as something

#### Scenario: Two types of one company may print the same sheet

- **GIVEN** a company with two active purchase-request types
- **WHEN** both are configured `print_templates = PR`
- **THEN** both are accepted and both print the purchase-request sheet

## MODIFIED Requirements

### Requirement: Attachments on External Storage
The system SHALL store attachment metadata in `document_attachment` and keep file
bytes on external object storage (S3/MinIO), never in the database. The system SHALL expose
an authenticated **upload** endpoint that receives the file bytes (multipart) and, after
validating the file against the allow-list `application/pdf`, `image/jpeg`, `image/png` and
enforcing a size cap on the received bytes, writes them to the bucket server-side (backend →
bucket) and records the metadata; the file bytes SHALL NOT be uploaded by the browser directly to
the bucket. The allow-list SHALL be enforced against the file's own leading bytes, not the
browser-declared content type, because the declared type is caller-supplied and the accepted bytes
are later merged into printed documents. The allow-list is deliberately narrow: an attachment is
evidence that has to appear on the printed document set, and only these three types can be placed
on a page without a document-conversion engine. Only the resulting object key, file name, size,
and mime type SHALL be persisted in `document_attachment` (`file_path` holds the key). The upload
endpoint SHALL be scoped to the active company. For retrieval the system SHALL issue a short-lived
presigned **download** URL. The system SHALL list a document's attachments, scoped to the active
company. Attachments stored before the allow-list narrowed SHALL remain listable and downloadable;
narrowing what may be uploaded SHALL NOT retract access to evidence already filed.

#### Scenario: Attach a receipt
- GIVEN a user uploads a PDF receipt to a document
- WHEN the upload completes
- THEN `document_attachment` stores the path, size, and mime type only

#### Scenario: File is uploaded through the API
- GIVEN a `DOC_CREATE` user in the active company selects a file for their document
- WHEN they POST the file bytes to the attachment upload endpoint
- THEN the backend validates and writes the bytes to object storage and returns the stored
  object key and attachment metadata, without the browser contacting the bucket directly

#### Scenario: Oversized or disallowed attachment is rejected
- GIVEN a user posts a file exceeding the size cap or of a type outside the allow-list
- WHEN the upload endpoint receives it
- THEN the request is rejected with a validation error and no object is written and no
  `document_attachment` row is created

#### Scenario: A file's declared type does not decide whether it is accepted
- GIVEN a spreadsheet posted with a declared content type of `application/pdf`
- WHEN the upload endpoint receives it
- THEN the leading bytes are recognised as not a PDF and the upload is rejected

#### Scenario: A file already stored outside the allow-list stays readable
- GIVEN a `document_attachment` of a type no longer accepted for upload
- WHEN a `DOC_VIEW` user lists the document's attachments and requests its download URL
- THEN the attachment is listed and a presigned URL is issued as before

#### Scenario: Presigned download URL is issued
- GIVEN a registered `document_attachment`
- WHEN a `DOC_VIEW` user requests its download URL
- THEN the system returns a short-lived presigned GET URL for the stored object key
