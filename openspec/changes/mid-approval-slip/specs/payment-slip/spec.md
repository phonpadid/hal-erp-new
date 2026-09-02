## MODIFIED Requirements

### Requirement: Attach Evidence to a Recorded Payment

A `PAYMENT_MANAGE` user SHALL be able to upload one or more slips against a `document` in the active company, each producing one `payment_attachment` row carrying `document_id`, `file_name`, `file_path`, `file_size_kb`, `mime_type`, `uploaded_by` and `uploaded_at`. `payment_attachment.document_id` SHALL be NOT NULL: a slip always names the document whose money it evidences. `payment_attachment.payment_id` SHALL be nullable and SHALL be set when a payment for that document exists, so a slip carries the payment as a second fact rather than as its identity. A document SHALL accept any number of slips. The upload SHALL be rejected for a document of another company. This flow SHALL NOT write `budget_txn` or `quota_usage`: the budget settled to `ACTUAL` when the document completed, and evidence settles nothing.

#### Scenario: A finance officer attaches the bank's slip

- **GIVEN** a document in the active company with a payment recorded against it
- **WHEN** a `PAYMENT_MANAGE` user uploads a slip against it
- **THEN** a `payment_attachment` row is stored naming that document and that payment, with the uploader and time
- **AND** no `budget_txn` row is written

#### Scenario: Several slips on one document

- **GIVEN** a document that already has a slip
- **WHEN** the user uploads a second file
- **THEN** both slips are attached to that document

#### Scenario: Another company's document is refused

- **GIVEN** a document belonging to a company the user is not acting in
- **WHEN** the user uploads a slip against it
- **THEN** the upload is rejected

### Requirement: Slip Reads Are Company-Scoped and Permission-Gated

A `PAYMENT_VIEW` user SHALL be able to list and download the slips of a document in the active company, whether or not a payment has been recorded for it, and reads SHALL be filtered by the active company before any other scope. A user without `PAYMENT_VIEW` SHALL NOT be able to list or download a slip. Slips SHALL NOT cross companies, including for a GROUP-scope reader.

#### Scenario: A viewer lists the evidence

- **GIVEN** a document with two slips in the active company
- **WHEN** a `PAYMENT_VIEW` user reads its slips
- **THEN** both are listed with their file names and download URLs

#### Scenario: A user without the read permission is refused

- **WHEN** a user lacking `PAYMENT_VIEW` requests a document's slips
- **THEN** the request is refused

#### Scenario: Evidence uploaded before payment is readable

- **GIVEN** a document carrying a slip and no recorded payment
- **WHEN** a `PAYMENT_VIEW` user reads its slips
- **THEN** the slip is listed rather than reported as not found

## ADDED Requirements

### Requirement: Evidence May Precede Its Payment

The system SHALL accept a slip for a document that has no `payment` row, so that evidence of a transfer can be recorded at the moment the transfer happens rather than only after the document completes approval. Uploading, listing, downloading and deleting a slip SHALL resolve the slip through its `document_id` and SHALL NOT require a `payment` to exist. A slip whose `payment_id` is null SHALL be treated as evidence of the same standing as one carrying a payment; nothing SHALL rank the two differently.

When a payment is later recorded for a document, the slips already attached to that document SHALL remain attached and SHALL NOT be duplicated, moved or invalidated.

#### Scenario: A slip is attached before any payment exists

- **GIVEN** a document in approval with no `payment` row
- **WHEN** a `PAYMENT_MANAGE` user uploads a slip against it
- **THEN** a `payment_attachment` row is written naming the document, with a null `payment_id`

#### Scenario: The earlier slip survives the payment being recorded

- **GIVEN** a document carrying a slip uploaded before any payment existed
- **WHEN** a payment is later recorded for that document
- **THEN** the existing slip is still listed for the document, and no second copy of it is created

#### Scenario: Deleting evidence that has no payment

- **GIVEN** a slip on a document with no recorded payment
- **WHEN** a `PAYMENT_SLIP_DELETE` user deletes it
- **THEN** the row is removed and its stored object is deleted, as for any other slip

### Requirement: Deleting Evidence Serialises Against Approval

A slip delete SHALL take a pessimistic write lock on its `document` before removing the row, so that a delete and an approval of a step requiring evidence cannot interleave. Either the delete commits first and the subsequent approval is refused for want of evidence, or the approval commits first and the delete follows it. The system SHALL NOT permit an approval to pass an evidence requirement that a concurrent delete has already removed.

An upload SHALL NOT take that lock, because an upload can only add evidence and no interleaving of an upload with an approval can produce an approval that passed without evidence.

#### Scenario: A delete racing an approval does not leave an unevidenced approval

- **GIVEN** a document with exactly one slip, at a step that requires payment evidence
- **WHEN** a delete of that slip and an approval of that step are attempted concurrently
- **THEN** either the approval is refused for want of evidence, or it commits before the delete
- **AND** no approval is recorded against a step whose evidence requirement was unmet at commit
