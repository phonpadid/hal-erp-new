## ADDED Requirements

### Requirement: Register and Replace Own Signature

The system SHALL expose an authenticated endpoint that lets the signed-in user upload a
signature image for themselves, resolving the user from the JWT and never from an id in
the request path. The image SHALL be stored in object storage (S3/MinIO) as a
`user_signature` row carrying its `file_path`, `mime_type`, and `file_size_kb`; the raw
bytes SHALL NOT be stored in the database. Each upload SHALL create a NEW immutable
`user_signature` row and SHALL set `app_user.current_signature_id` to it; a previous
signature row and its stored file SHALL NOT be overwritten or deleted. The endpoint SHALL
accept only image content (allow-list of `image/png` and `image/jpeg`) and SHALL reject
oversized or non-image uploads with a validation error.

#### Scenario: User uploads their first signature

- **WHEN** an authenticated user with no signature uploads a PNG image
- **THEN** a `user_signature` row is created with its object-storage `file_path`
- **AND** `app_user.current_signature_id` points to that row
- **AND** no signature bytes are stored in the database

#### Scenario: Replacing a signature keeps the old file immutable

- **GIVEN** a user with an existing current signature referenced by past approvals
- **WHEN** the user uploads a new signature
- **THEN** a new `user_signature` row is created and `current_signature_id` points to it
- **AND** the previous `user_signature` row and its stored file remain unchanged

#### Scenario: Non-image upload is rejected

- **WHEN** the user uploads a file whose mime type is not in the image allow-list
- **THEN** the request is rejected with a validation error and no `user_signature` row is created

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
