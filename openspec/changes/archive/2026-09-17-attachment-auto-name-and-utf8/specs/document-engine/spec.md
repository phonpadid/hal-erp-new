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

The system SHALL name each new attachment itself. `document_attachment.file_name` SHALL be
`<doc_no>-<nn><ext>`: the document's `doc_no`, a hyphen, a two-digit sequence counting that
document's attachments in upload order from `01`, and the extension the validated content type
implies (`.pdf`, `.jpg`, `.png`) — never the extension the browser supplied. The sequence SHALL be
derived under the document's row lock in the same transaction that records the row, so two
uploads arriving together receive distinct numbers. What the uploader called the file SHALL be
kept, correctly decoded, in `document_attachment.original_file_name`; it is informational and
SHALL NOT be used as a storage key or a caption. Attachments recorded before this rule keep the
`file_name` they were filed under and a null `original_file_name`.

Every multipart upload endpoint SHALL decode the incoming filename as UTF-8. A Lao filename SHALL
arrive as the uploader wrote it, not as the latin1 rendering of its bytes. Filenames stored before
this rule that are the latin1 rendering of valid UTF-8 SHALL be repaired once, by data migration,
to the text they encode; a name that already reads correctly SHALL NOT be touched, and the repair
SHALL be idempotent. The object key stays as stored: renaming an object buys nothing and risks a
`file_path` that points at nothing.

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

#### Scenario: The system names the attachment after the document

- **GIVEN** document `RECBL-HAL-2026-0029` with no attachments, and a user who uploads
  `ໃບສະເໜີ ລົດຮ່ວມ (ສັນຍາ).pdf` and then a JPEG photo
- **WHEN** both uploads complete
- **THEN** the attachments are named `RECBL-HAL-2026-0029-01.pdf` and `RECBL-HAL-2026-0029-02.jpg`,
  and the first row's `original_file_name` is `ໃບສະເໜີ ລົດຮ່ວມ (ສັນຍາ).pdf`

#### Scenario: The extension follows the bytes, not the browser

- **WHEN** a PNG image is uploaded under the name `scan.jpeg`
- **THEN** the generated name ends in `.png`

#### Scenario: Concurrent uploads never share a number

- **WHEN** two files are uploaded to the same document at the same moment
- **THEN** one is `-01` and the other `-02`, and both rows exist

#### Scenario: A Lao filename is stored as written

- **WHEN** a file named `ໃບເບີກຈ່າຍ.pdf` is uploaded to any multipart endpoint
- **THEN** the name the server receives and stores as `original_file_name` (or, for slips, as
  `file_name`) is `ໃບເບີກຈ່າຍ.pdf`, not `à»àºà»àºàºµàºàºà»àº²àº.pdf`

#### Scenario: Garbled names already stored are repaired once

- **GIVEN** a `document_attachment` whose `file_name` is the latin1 rendering of a UTF-8 Lao name,
  and another whose `file_name` is `CamScanner 15-09-2026.pdf`
- **WHEN** the repair migration runs, and runs again
- **THEN** the first reads as its Lao name and the second is unchanged, both times
