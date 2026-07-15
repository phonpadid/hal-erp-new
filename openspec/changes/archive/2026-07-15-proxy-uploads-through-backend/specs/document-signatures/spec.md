## MODIFIED Requirements

### Requirement: Register and Replace Own Signature

The system SHALL expose an authenticated endpoint that lets the signed-in user upload a
signature image for themselves, resolving the user from the JWT and never from an id in
the request path. The signature bytes SHALL be sent to the backend (multipart), which
validates them and writes them to object storage (S3/MinIO) server-side; the browser SHALL
NOT PUT the bytes directly to the bucket. The image SHALL be stored as a `user_signature`
row carrying its `file_path`, `mime_type`, and `file_size_kb`; the raw bytes SHALL NOT be
stored in the database. Each upload SHALL create a NEW immutable `user_signature` row and
SHALL set `app_user.current_signature_id` to it; a previous signature row and its stored
file SHALL NOT be overwritten or deleted. The endpoint SHALL accept only image content
(allow-list of `image/png` and `image/jpeg`) validated against the received bytes and SHALL
reject oversized or non-image uploads with a validation error.

#### Scenario: User uploads their first signature

- **WHEN** an authenticated user with no signature uploads a PNG image to the signature
  upload endpoint
- **THEN** the backend writes the bytes to object storage and a `user_signature` row is
  created with its object-storage `file_path`
- **AND** `app_user.current_signature_id` points to that row
- **AND** no signature bytes are stored in the database

#### Scenario: Replacing a signature keeps the old file immutable

- **GIVEN** a user with an existing current signature referenced by past approvals
- **WHEN** the user uploads a new signature
- **THEN** a new `user_signature` row is created and `current_signature_id` points to it
- **AND** the previous `user_signature` row and its stored file remain unchanged

#### Scenario: Non-image upload is rejected

- **WHEN** the user uploads a file whose mime type is not in the image allow-list
- **THEN** the request is rejected with a validation error and no object is written and no
  `user_signature` row is created

#### Scenario: Signature belongs to the user across companies

- **GIVEN** a user linked to employees in more than one company
- **WHEN** the user uploads a signature
- **THEN** the single `user_signature` is associated with the `app_user`, not a company,
  and is usable when the user approves documents in any company they belong to
