## MODIFIED Requirements

### Requirement: Attachments on External Storage
The system SHALL store attachment metadata in `document_attachment` and keep file
bytes on external object storage (S3/MinIO), never in the database. The system SHALL expose
an authenticated **upload** endpoint that receives the file bytes (multipart) and, after
validating the mime type against the image/document allow-list and enforcing a size cap on
the received bytes, writes them to the bucket server-side (backend → bucket) and records the
metadata; the file bytes SHALL NOT be uploaded by the browser directly to the bucket. Only
the resulting object key, file name, size, and mime type SHALL be persisted in
`document_attachment` (`file_path` holds the key). The upload endpoint SHALL be scoped to the
active company. For retrieval the system SHALL issue a short-lived presigned **download**
URL. The system SHALL list a document's attachments, scoped to the active company.

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
- GIVEN a user posts a file exceeding the size cap or with a mime type not in the allow-list
- WHEN the upload endpoint receives it
- THEN the request is rejected with a validation error and no object is written and no
  `document_attachment` row is created

#### Scenario: Presigned download URL is issued
- GIVEN a registered `document_attachment`
- WHEN a `DOC_VIEW` user requests its download URL
- THEN the system returns a short-lived presigned GET URL for the stored object key
