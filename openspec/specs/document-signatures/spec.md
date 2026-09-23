# Document Signatures Specification

## Purpose
Self-service storage of a user's reusable signature image: the signed-in user
uploads, replaces, and reads their own signature, stored as immutable, versioned
files in object storage (S3/MinIO) and never as a database blob. Each signature is
personal to the `app_user` (not a company), and every historical `approval_log`
snapshot that references a signature always resolves to the exact image used at
approval time.

## Requirements
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

### Requirement: Read Own Signature

The system SHALL expose an authenticated endpoint that returns the signed-in user's own
current signature (or an indication that none exists), resolving the user from the JWT.
The endpoint SHALL NOT accept a user id in the request path, so a user can only read their
own signature and never another user's.

#### Scenario: User reads their current signature

- **GIVEN** an authenticated user with a current signature
- **WHEN** they request their signature
- **THEN** the response returns the current signature image (or a retrievable reference to it)

#### Scenario: User without a signature

- **WHEN** an authenticated user with no signature requests it
- **THEN** the response indicates no signature is on file rather than returning an error

### Requirement: Signature Snapshot Immutability

A `user_signature` row SHALL be treated as immutable once created: its `file_path` and the
underlying stored file SHALL NOT be modified, so any `approval_log.signature_id` pointing
at it always resolves to the exact image used at approval time. Deleting a signature file
SHALL NOT be permitted while any `approval_log` row references it.

#### Scenario: Historical signature is unchanged after replacement

- **GIVEN** an approval whose `approval_log.signature_id` references signature S1
- **WHEN** the approver later uploads a new signature S2
- **THEN** the approval still references S1 and the S1 file is byte-for-byte unchanged

### Requirement: Uploading a Signature Clears the Gates That Waited on It

The signature panel on the profile page SHALL, after a successful upload, update the session
context's `hasSignature` to true without requiring a reload, so every affordance elsewhere in
the app that was disabled for want of a signature (new document, submit, approve) becomes
available the moment the upload completes. The panel SHALL say, when no signature is on file,
that submitting and approving documents needs one — the reason a person arrived there.

#### Scenario: The context follows the upload

- **GIVEN** a signed-in user with no signature whose context says `hasSignature: false`
- **WHEN** their upload on the profile page completes
- **THEN** the context says `hasSignature: true` and no reload has happened

#### Scenario: The empty panel says why it matters

- **WHEN** a user with no signature opens the profile page
- **THEN** the signature panel states that a signature is required to submit and approve
  documents
