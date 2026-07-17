## ADDED Requirements

### Requirement: Attach Evidence to a Recorded Payment

A `PAYMENT_MANAGE` user SHALL be able to upload one or more slips against a `payment` in the active company, each producing one `payment_attachment` row carrying `file_name`, `file_path`, `file_size_kb`, `mime_type`, `uploaded_by` and `uploaded_at`. A payment SHALL accept any number of slips, including none — evidence is not a precondition of payment. The upload SHALL be rejected for a payment of another company. This flow SHALL NOT write `budget_txn` or `quota_usage`: the budget settled to `ACTUAL` when the document completed, and evidence settles nothing.

#### Scenario: A finance officer attaches the bank's slip

- **GIVEN** a payment recorded in the active company
- **WHEN** a `PAYMENT_MANAGE` user uploads a slip against it
- **THEN** a `payment_attachment` row is stored for that payment with the uploader and time
- **AND** no `budget_txn` row is written

#### Scenario: Several slips on one payment

- **GIVEN** a payment that already has a slip
- **WHEN** the user uploads a second file
- **THEN** both slips are attached to that payment

#### Scenario: A payment with no evidence stays valid

- **WHEN** a payment is recorded and no slip is ever uploaded
- **THEN** the payment is unaffected and reads exactly as one with slips

#### Scenario: Another company's payment is refused

- **GIVEN** a payment belonging to a company the user is not acting in
- **WHEN** the user uploads a slip against it
- **THEN** the upload is rejected

### Requirement: Slip Bytes Live in Object Storage

The system SHALL store slip metadata in `payment_attachment` and keep the file bytes out of the database, with `file_path` holding the storage key, mirroring `document_attachment`. The storage key SHALL NOT be exposed to the client; a download SHALL be served through a presigned URL. Every upload SHALL pass the same size and content validation as a document attachment.

#### Scenario: Metadata and bytes are separated

- **WHEN** a slip is uploaded
- **THEN** the row holds its name, size, mime type and storage key
- **AND** the bytes are written to object storage, not to a database column

#### Scenario: The client never sees a storage key

- **WHEN** a user reads a payment's slips
- **THEN** each slip is returned with a presigned download URL rather than its `file_path`

#### Scenario: An oversized file is refused

- **WHEN** a user uploads a file larger than the accepted limit
- **THEN** the upload is rejected and no `payment_attachment` row is written

### Requirement: Slip Reads Are Company-Scoped and Permission-Gated

A `PAYMENT_VIEW` user SHALL be able to list and download the slips of a payment in the active company, and reads SHALL be filtered by the active company before any other scope. A user without `PAYMENT_VIEW` SHALL NOT be able to list or download a slip. Slips SHALL NOT cross companies, including for a GROUP-scope reader.

#### Scenario: A viewer lists the evidence

- **GIVEN** a payment with two slips in the active company
- **WHEN** a `PAYMENT_VIEW` user reads its slips
- **THEN** both are listed with their file names and download URLs

#### Scenario: A user without the read permission is refused

- **WHEN** a user lacking `PAYMENT_VIEW` requests a payment's slips
- **THEN** the request is refused

### Requirement: Deleting a Slip Needs Its Own Permission

Deleting a slip SHALL require `PAYMENT_SLIP_DELETE`, which SHALL be a distinct permission code and SHALL NOT be implied by `PAYMENT_MANAGE`. A delete SHALL remove both the `payment_attachment` row and its stored object, so that no row points at missing bytes and no unreachable bytes retain the file's contents. A user holding `PAYMENT_MANAGE` alone SHALL be able to upload a slip but not delete one.

#### Scenario: A holder of the delete permission removes a slip

- **GIVEN** a payment with a slip
- **WHEN** a `PAYMENT_SLIP_DELETE` user deletes it
- **THEN** the row is removed and its stored object is deleted

#### Scenario: Recording a payment does not confer removing its evidence

- **GIVEN** a user holding `PAYMENT_MANAGE` but not `PAYMENT_SLIP_DELETE`
- **WHEN** the user deletes a slip
- **THEN** the request is refused and the slip remains
