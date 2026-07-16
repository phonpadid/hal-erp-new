## MODIFIED Requirements

### Requirement: Ready-to-Pay Queue

The system SHALL expose a read-only, company-scoped, `PAYMENT_VIEW`-gated ready-to-pay queue derived from `COMPLETED` documents whose type `post_action` is `CUT_BUDGET` that do **not** yet have a `payment` record **and are not held by a `DRAFT` or `EXPORTED` `payment_batch`**, listing the document, vendor, **payee bank account**, settled base amount (the document's base total — equal to the actual posted to the budget), and GL account(s), so an external accounting system can pull payables. The queue SHALL be derived, not stored, and SHALL respect company isolation. Excluding documents already held by an open batch is what stops the same payable from being exported to the bank on two files; the unique constraint on `payment.document_id` catches a double only at import, after the money has already moved.

#### Scenario: Settled disbursement appears in the queue

- **GIVEN** a settled `CUT_BUDGET` document in the active company with no payment yet
- **WHEN** a `PAYMENT_VIEW` user reads the ready-to-pay queue
- **THEN** the document appears with its vendor, payee bank account, base actual amount, and GL

#### Scenario: A paid disbursement leaves the queue

- **GIVEN** a settled disbursement that has been recorded as paid
- **WHEN** the ready-to-pay queue is read
- **THEN** that disbursement is no longer listed

#### Scenario: A disbursement on an open batch leaves the queue

- **GIVEN** a settled disbursement held by a `DRAFT` or `EXPORTED` batch
- **WHEN** the ready-to-pay queue is read
- **THEN** that disbursement is not listed, so it cannot be batched twice

#### Scenario: A disbursement on a cancelled batch returns to the queue

- **GIVEN** a settled disbursement whose only batch was cancelled without paying it
- **WHEN** the ready-to-pay queue is read
- **THEN** that disbursement is listed again

#### Scenario: Queue is company-scoped

- **WHEN** the queue is read in one company
- **THEN** another company's settled documents are not listed

## ADDED Requirements

### Requirement: Payments Record the Batch That Produced Them

The system SHALL carry a nullable `payment.batch_id` referencing the `payment_batch` whose result import created the payment, left null for a payment recorded through the single-document endpoint. The link SHALL make every paid document traceable to the exact bank file it went out on. Setting `batch_id` SHALL NOT change how the FX delta or withholding tax is computed — both stay the responsibility of the existing record-payment path, called once per succeeded line.

#### Scenario: An imported payment names its batch

- **WHEN** a payment is created by importing a batch result
- **THEN** its `batch_id` is the batch that was imported

#### Scenario: A manually recorded payment has no batch

- **WHEN** a payment is recorded through the single-document endpoint
- **THEN** its `batch_id` is null

#### Scenario: The FX breakdown is unchanged by batching

- **GIVEN** a disbursement paid at an actual rate through a batch import
- **THEN** the `fx_delta` and `fx_kind` match what the single-document path would have recorded for the same rate
