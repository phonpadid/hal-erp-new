# payment-batch Specification

## Purpose
Batch payment runs: build a company-scoped batch from the ready-to-pay queue, export it as a
bank file through a configuration-selected formatter, and import the bank's result to record
one payment per succeeded line. Batches never touch the budget — the budget was settled when
the document completed.

## Requirements

### Requirement: Build a Payment Batch from the Ready-to-Pay Queue

The system SHALL let a `PAYMENT_BATCH_MANAGE` user create a company-scoped `payment_batch` from a set of documents drawn from the ready-to-pay queue, rejecting any document that is not currently payable in the active company. Each selected document SHALL produce one `payment_batch_line` snapshotting `bank_code`, `account_no`, `account_name`, the payable amount in the document currency, and an optional `wht_tax_code_id`; the snapshot SHALL NOT be a live reference, so a later edit to `vendor_bank_account` cannot rewrite an exported batch. A new batch SHALL start at `status` `DRAFT`. This flow SHALL NOT write `budget_txn` or `quota_usage`: the budget was settled to `ACTUAL` when the `CUT_BUDGET` document completed, and re-touching it would charge the budget twice.

#### Scenario: A batch snapshots the payee at draft time

- **WHEN** a `PAYMENT_BATCH_MANAGE` user builds a batch from two payables
- **THEN** the batch is `DRAFT` with two lines, each carrying the document's payee bank details copied in

#### Scenario: Editing the vendor account later does not change the batch

- **GIVEN** a batch line snapshotting account number `111`
- **WHEN** the vendor's account is edited to `222`
- **THEN** the batch line still reads `111`

#### Scenario: A document that is not payable is rejected

- **WHEN** a batch is built including a document that is already paid or not `COMPLETED`
- **THEN** the request is rejected

#### Scenario: Another company's payable cannot be batched

- **WHEN** a batch is built including a document belonging to another company
- **THEN** the request is rejected

#### Scenario: Building a batch writes no ledger row

- **WHEN** a batch is created
- **THEN** no `budget_txn` and no `quota_usage` row is written

### Requirement: Batch Export Produces a Stored Bank File

The system SHALL, on export by a `PAYMENT_BATCH_MANAGE` user, render the batch's lines through the formatter named by the batch's `format` discriminator, persist the rendered bytes to external storage under a `payment-batches/{batchId}/` key, record that key on the batch, and move `status` from `DRAFT` to `EXPORTED`. Lines SHALL be immutable once `EXPORTED`. The exported per-line amount SHALL be the payable amount net of `wht_amount` when the line carries a withholding tax code, since the vendor is paid net. Re-exporting an `EXPORTED` batch SHALL return the stored bytes rather than re-rendering, so the file the bank received stays reproducible. Exporting a batch that is not `DRAFT` or `EXPORTED` SHALL be rejected.

#### Scenario: Export writes the file and freezes the batch

- **WHEN** a `DRAFT` batch is exported
- **THEN** the file is stored, its key is recorded on the batch, and the batch becomes `EXPORTED`

#### Scenario: Lines cannot be changed after export

- **WHEN** a line of an `EXPORTED` batch is edited or removed
- **THEN** the request is rejected

#### Scenario: Withholding tax is deducted in the file

- **GIVEN** a line of 100000 with a 3% withholding code
- **WHEN** the batch is exported
- **THEN** the file carries 97000 for that line

#### Scenario: Re-downloading returns the same bytes

- **WHEN** an `EXPORTED` batch is exported again
- **THEN** the originally stored bytes are returned unchanged

### Requirement: Export Fails Loudly on a Deactivated Payee

The system SHALL reject the export of a batch containing a line whose referenced `vendor_bank_account` is no longer active, naming the offending document and account. The system SHALL NOT substitute the vendor's primary account, because the approvers approved a specific destination and silently redirecting the money would defeat the approval.

#### Scenario: A closed account blocks the export

- **GIVEN** a `DRAFT` batch line whose payee account was deactivated after the document was approved
- **WHEN** the batch is exported
- **THEN** the export is rejected, naming that document and account, and the batch stays `DRAFT`

#### Scenario: No silent fallback to primary

- **GIVEN** the same batch and an active primary account on that vendor
- **WHEN** the batch is exported
- **THEN** the export still fails rather than paying the primary account

### Requirement: Result Import Records Payments per Line

The system SHALL let a `PAYMENT_BATCH_MANAGE` user upload the bank's result file against an `EXPORTED` batch, taking `LockMode.PESSIMISTIC_WRITE` on the `payment_batch` row so two concurrent uploads for one batch serialize, and applying every line in a single `em.transactional`. For each line the bank reports as succeeded, the system SHALL create one `payment` at the actual exchange rate supplied by the user for that line, carrying the line's `wht_tax_code_id`, and SHALL set `payment.batch_id` to the batch. For each line the bank reports as failed, the system SHALL record the bank's reason on the line and create no `payment`. A file that cannot be parsed SHALL abort the whole import; a line the bank rejected SHALL NOT. The batch SHALL become `COMPLETED` when every line succeeded, else `PARTIAL`. This flow SHALL NOT write `budget_txn`: the FX delta discovered here belongs to accounting and reaches it through the existing `payment.settled` event, never to the budget, whose basis stays the rate locked at submit.

#### Scenario: A fully successful result completes the batch

- **GIVEN** an `EXPORTED` batch of two lines the bank reports as succeeded
- **WHEN** the result is uploaded with an actual rate per line
- **THEN** two `payment` rows are created carrying `batch_id`, and the batch becomes `COMPLETED`

#### Scenario: A rejected line leaves the batch partial

- **GIVEN** a two-line batch where the bank rejected one line
- **WHEN** the result is uploaded
- **THEN** one `payment` is created, the rejected line records the bank's reason, and the batch becomes `PARTIAL`

#### Scenario: A rejected line's document returns to the queue

- **GIVEN** the batch above
- **WHEN** the ready-to-pay queue is read
- **THEN** the rejected line's document is listed again, with no requeue action taken

#### Scenario: A malformed file changes nothing

- **WHEN** an unparseable result file is uploaded
- **THEN** the import is rejected and no `payment` row and no batch status change is written

#### Scenario: Import writes no budget row

- **WHEN** a result is imported at an actual rate differing from the locked rate
- **THEN** the `payment` records the FX delta and no `budget_txn` is written

#### Scenario: Importing against a non-exported batch is rejected

- **WHEN** a result is uploaded against a `DRAFT` batch
- **THEN** the request is rejected

### Requirement: Re-Uploading a Result Never Pays Twice

The system SHALL treat a line whose document already has a `payment` as a no-op and report it as already paid, relying on the unique constraint on `payment.document_id` as the authority rather than a status check. Uploading the same result file twice SHALL leave exactly one payment per document and SHALL NOT raise an error.

#### Scenario: The same result file uploaded twice

- **GIVEN** a batch whose result was already imported
- **WHEN** the identical result file is uploaded again
- **THEN** each document still has exactly one `payment`, and the lines are reported as already paid

### Requirement: Cancelling a Batch Returns Its Payables

The system SHALL let a `PAYMENT_BATCH_MANAGE` user cancel a `DRAFT` or `EXPORTED` batch, moving it to `CANCELLED` so its unpaid documents become payable again. Cancelling SHALL NOT touch any `payment` already created from the batch, so a `PARTIAL` batch's successful payments survive. A `COMPLETED` batch SHALL NOT be cancellable.

#### Scenario: Cancelling frees the payables

- **GIVEN** an `EXPORTED` batch whose file was never sent
- **WHEN** it is cancelled
- **THEN** the batch is `CANCELLED` and its documents appear in the ready-to-pay queue again

#### Scenario: Cancelling a partial batch keeps its payments

- **GIVEN** a `PARTIAL` batch with one recorded payment
- **WHEN** it is cancelled
- **THEN** the payment remains and only the unpaid document returns to the queue

#### Scenario: A completed batch cannot be cancelled

- **WHEN** cancelling a `COMPLETED` batch
- **THEN** the request is rejected

### Requirement: Batch Reads Are Company-Scoped and Permission-Gated

The system SHALL expose batch reads to `PAYMENT_BATCH_VIEW` and every mutation to `PAYMENT_BATCH_MANAGE`, filtered to the active company first. A batch of another company SHALL NOT be readable, exportable, importable, or cancellable, and SHALL be indistinguishable from a batch that does not exist.

#### Scenario: Batches are listed per company

- **WHEN** a `PAYMENT_BATCH_VIEW` user lists batches
- **THEN** only the active company's batches are returned

#### Scenario: Cross-company access is refused

- **WHEN** a user reads or exports another company's batch
- **THEN** the request is refused as not found

#### Scenario: Managing without permission is denied

- **GIVEN** a user with `PAYMENT_BATCH_VIEW` only
- **WHEN** they export a batch
- **THEN** the request is denied

### Requirement: Bank File Format Is Selected by Configuration

The system SHALL render a batch through a `BankFileFormatter` chosen by the batch's stored `format` value, with `CSV` as the only implementation in this change. The CSV file SHALL carry a header row and one row per payable — bank code, account number, account name, amount, currency, and a reference — and the result file SHALL be matched back on that reference rather than on account number and amount, which are ambiguous when one vendor is paid twice for the same amount in a run. **The concrete column set is provisional**: no bank has confirmed it, and it SHALL be replaceable by editing the formatter alone, with no change to the schema, the batch lifecycle, or any export rule. Adding a format SHALL NOT require a schema change, per invariant 7. An unknown `format` SHALL be rejected at export rather than falling back to a default.

#### Scenario: CSV is rendered through the seam

- **WHEN** a batch with `format` `CSV` is exported
- **THEN** the CSV formatter renders it, with a header row and one row per payable

#### Scenario: An account number keeps its leading zeros

- **WHEN** a payee account number beginning with a zero is exported
- **THEN** the file carries it verbatim as text, because an account number identifies rather than measures

#### Scenario: A result file is matched on the reference we issued

- **GIVEN** an exported CSV carrying a reference per line
- **WHEN** the bank's result file returns those references with a status
- **THEN** each row is matched to its line by reference, and a reference this batch never issued rejects the whole file

#### Scenario: An unknown format is rejected

- **WHEN** a batch carries a `format` with no registered formatter
- **THEN** the export is rejected rather than defaulting

### Requirement: A Batch Records The Account It Paid From

A payment batch SHALL carry the company bank account it draws on, set when it is built. Importing a
batch's result SHALL stamp that account onto every payment the import records.

It SHALL be optional: a company that has not configured its bank accounts must still be able to pay,
and a batch without one SHALL behave exactly as it did before — its payments carry no bank account
and appear in the unattributed reconciliation read, which exists so that cash in flight nobody
attributed is visible rather than lost.

Batches and payments recorded before this SHALL NOT be given a derived account. A batch that
predates the column cannot say which account it drew on, and choosing the company's only one would
be a guess written as a fact about money.

#### Scenario: A batch names its account and its payments inherit it

- **GIVEN** a batch built against a bank account
- **WHEN** its result is imported and payments are recorded
- **THEN** each payment carries that bank account

#### Scenario: A batch without an account still pays

- **GIVEN** a batch built with no bank account
- **WHEN** its result is imported
- **THEN** the payments are recorded, carrying none, and appear as unattributed

#### Scenario: Another company's bank account is refused

- **WHEN** a batch is built naming a bank account of another company
- **THEN** it is rejected
