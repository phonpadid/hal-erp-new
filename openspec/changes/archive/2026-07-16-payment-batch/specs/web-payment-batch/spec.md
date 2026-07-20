## ADDED Requirements

### Requirement: Build a Batch from the Ready-to-Pay List

The web app SHALL let a `PAYMENT_BATCH_MANAGE` user select payables from the ready-to-pay list and build a `DRAFT` batch from them, showing each candidate's vendor, payee bank account, and payable amount, and letting the user set a withholding tax code per line before export. The running total SHALL be formatted using the currency's `decimal_places` and SHALL never be computed as a JS number. The build affordance SHALL be shown only to `PAYMENT_BATCH_MANAGE` and the batch views only to `PAYMENT_BATCH_VIEW` (UX only; the server enforces and scopes by company).

#### Scenario: Selecting payables builds a batch

- **WHEN** a `PAYMENT_BATCH_MANAGE` user selects two payables and builds a batch
- **THEN** a `DRAFT` batch with two lines is created and shown

#### Scenario: Withholding is set per line before export

- **WHEN** the user sets a withholding tax code on a draft line
- **THEN** the line shows the net amount that will be exported

#### Scenario: Build hidden without permission

- **GIVEN** a user with `PAYMENT_VIEW` but not `PAYMENT_BATCH_MANAGE`
- **WHEN** they open the ready-to-pay list
- **THEN** the build-batch action is not shown

### Requirement: Export and Download the Bank File

The web app SHALL let a `PAYMENT_BATCH_MANAGE` user export a `DRAFT` batch and download the resulting file, after which the batch SHALL render as `EXPORTED` with its lines read-only. When the export is refused because a payee account is no longer active, the app SHALL show which document and account caused it rather than a generic failure, since the fix is to have that document returned and resubmitted.

#### Scenario: Exporting yields a downloadable file

- **WHEN** a `PAYMENT_BATCH_MANAGE` user exports a `DRAFT` batch
- **THEN** the file downloads and the batch shows as `EXPORTED` with read-only lines

#### Scenario: A closed payee account is explained

- **GIVEN** a batch whose line references a deactivated account
- **WHEN** the user exports it
- **THEN** the app names the offending document and account and the batch stays `DRAFT`

#### Scenario: Re-downloading an exported batch

- **WHEN** the user downloads an `EXPORTED` batch again
- **THEN** the same file is returned

### Requirement: Upload the Result and Review Per-Line Outcomes

The web app SHALL let a `PAYMENT_BATCH_MANAGE` user upload the bank's result file against an `EXPORTED` batch, entering the actual exchange rate per line, defaulted to the rate locked on the document so a base-currency payment needs no typing. After import the app SHALL show each line's outcome — paid with its FX gain/loss, rejected with the bank's reason, or already paid — and the batch's resulting `COMPLETED` or `PARTIAL` status. The app SHALL state that rejected lines return to the ready-to-pay list on their own.

#### Scenario: Importing shows what happened per line

- **WHEN** a result file is uploaded for a two-line batch where the bank rejected one line
- **THEN** one line shows as paid with its FX result, the other shows the bank's reason, and the batch shows `PARTIAL`

#### Scenario: Rates default to the locked rate

- **WHEN** the user opens the result upload for a batch
- **THEN** each line's actual rate is prefilled with the document's locked rate

#### Scenario: A malformed file is explained

- **WHEN** an unparseable file is uploaded
- **THEN** the app reports the file could not be read and shows the batch unchanged

### Requirement: Cancel a Batch

The web app SHALL let a `PAYMENT_BATCH_MANAGE` user cancel a `DRAFT` or `EXPORTED` batch, warning first that cancelling an `EXPORTED` batch is only safe when the file was never sent to the bank, because the system cannot know whether it was. The cancel affordance SHALL NOT be offered on a `COMPLETED` batch.

#### Scenario: Cancelling an exported batch warns first

- **WHEN** the user cancels an `EXPORTED` batch
- **THEN** the app warns that the file may already be with the bank and requires confirmation

#### Scenario: No cancel on a completed batch

- **WHEN** the user views a `COMPLETED` batch
- **THEN** no cancel action is shown

### Requirement: Batch List Surfaces Stalled Runs

The web app SHALL list the active company's batches with status, line count, total, and age, and SHALL visually flag an `EXPORTED` batch that has gone unimported beyond a threshold. A batch stuck in `EXPORTED` holds its documents out of the ready-to-pay list, so the payables silently go unpaid with no error anywhere — the list is where that becomes visible.

#### Scenario: Batches are listed with their state

- **WHEN** a `PAYMENT_BATCH_VIEW` user opens the batch list
- **THEN** the active company's batches are listed with status, line count, total, and age

#### Scenario: A stalled export is flagged

- **GIVEN** an `EXPORTED` batch older than the threshold with no result imported
- **WHEN** the batch list is read
- **THEN** that batch is visually flagged

#### Scenario: Empty list

- **WHEN** no batches exist
- **THEN** the list shows an empty state rather than an error
