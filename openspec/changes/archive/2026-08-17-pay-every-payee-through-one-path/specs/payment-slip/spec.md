# payment-slip

## MODIFIED Requirements

### Requirement: Attach Evidence to a Recorded Payment

A `PAYMENT_MANAGE` user SHALL be able to upload one or more slips against a `payment` in the active company, each producing one `payment_attachment` row carrying `file_name`, `file_path`, `file_size_kb`, `mime_type`, `uploaded_by` and `uploaded_at`. A payment SHALL accept any number of slips. The upload SHALL be rejected for a payment of another company. This flow SHALL NOT write `budget_txn` or `quota_usage`: the budget settled to `ACTUAL` when the document completed, and evidence settles nothing.

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

## ADDED Requirements

### Requirement: Evidence Is Required Where No Bank File Exists

A payment recorded by hand SHALL carry at least one evidence file, supplied with the record itself, and SHALL be refused without one. A payment produced by importing a bank batch's result SHALL NOT require one.

The condition SHALL be the absence of a batch, not the document's type and not the amount. A batched payment is already evidenced by the file the company sent and the statement the bank returned; a payment typed in by one person has nothing behind it but that person's word, and it is the one an auditor cannot otherwise substantiate. Requiring a slip where a bank file already exists is ceremony, and accepting a hand-recorded payment without one is the hole the ceremony was hiding.

The evidence SHALL be supplied in the same request that records the payment, and the payment SHALL NOT be written without it. Recording first and requiring evidence afterwards leaves a payment nobody is obliged to justify, and no later check can distinguish one that will be evidenced from one that never will be.

The payment and its evidence SHALL commit together. Its ledger entry SHALL NOT: posting runs after the payment commits, as it does for every payment, so a chart-of-accounts fault cannot roll back a record of money that has already left. The entry is owed, recorded and retryable through the posting engine like any other.

A refusal SHALL leave nothing behind: no `payment` row, no `payment_attachment` row, no ledger entry, and no object in storage. Validation that can refuse a request SHALL run before anything is written anywhere, because object storage is not transactional and an object written for a refused payment is one nobody will ever look for.

#### Scenario: A hand-recorded payment requires its slip

- **GIVEN** a document the company owes and no open batch holding it
- **WHEN** a `PAYMENT_MANAGE` user records a payment against it with no evidence file
- **THEN** the request is rejected and no payment, attachment, ledger entry or stored object exists for it

#### Scenario: A hand-recorded payment with evidence is written whole

- **WHEN** the same payment is recorded with one evidence file
- **THEN** the payment and its attachment are written together, and its ledger entry follows through
  the posting engine like every other payment's

#### Scenario: A cash payment to a person requires evidence like any other

- **GIVEN** a claim payable paid in cash
- **WHEN** the payment is recorded with no file
- **THEN** the request is rejected

#### Scenario: A batched payment needs no slip

- **GIVEN** a batch whose result file is imported
- **WHEN** the payments it produces are recorded
- **THEN** none of them requires an evidence file, and each is traceable to the batch that produced it

#### Scenario: A batched payment may still be evidenced

- **GIVEN** a payment produced by a batch
- **WHEN** a `PAYMENT_MANAGE` user uploads a slip against it
- **THEN** the slip is attached, because evidence beyond the bank file is never refused
