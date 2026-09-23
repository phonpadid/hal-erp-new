## MODIFIED Requirements

### Requirement: Attach Evidence to a Recorded Payment

A `PAYMENT_MANAGE` user SHALL be able to upload one or more slips against a `payment` in the active company, each producing one `payment_attachment` row carrying `file_name`, `file_path`, `file_size_kb`, `mime_type`, `uploaded_by` and `uploaded_at`. A payment SHALL accept any number of slips. The upload SHALL be rejected for a payment of another company. This flow SHALL NOT write `budget_txn` or `quota_usage`: the budget settled to `ACTUAL` when the document completed, and evidence settles nothing.

The slip's `file_name` SHALL be the uploader's filename decoded as UTF-8, kept as given — a slip is
named by the bank or the phone that photographed it, and the system SHALL NOT rename it. Slip
filenames stored before UTF-8 decoding that are the latin1 rendering of valid UTF-8 SHALL be
repaired once by the same idempotent migration that repairs document attachments.

#### Scenario: A finance officer attaches the bank's slip

- **GIVEN** a payment recorded in the active company
- **WHEN** a `PAYMENT_MANAGE` user uploads a slip against it
- **THEN** a `payment_attachment` row is stored for that payment with the uploader and time
- **AND** no `budget_txn` row is written

#### Scenario: Several slips on one payment

- **GIVEN** a payment that already has a slip
- **WHEN** the user uploads a second file
- **THEN** both slips are attached to that payment

#### Scenario: Another company's payment is refused

- **GIVEN** a payment belonging to a company the user is not acting in
- **WHEN** the user uploads a slip against it
- **THEN** the upload is rejected

#### Scenario: A Lao slip name survives the upload

- **WHEN** a slip named `ສະລິບໂອນ 15-09.jpg` is uploaded
- **THEN** its `payment_attachment.file_name` is `ສະລິບໂອນ 15-09.jpg`
