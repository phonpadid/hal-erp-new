## ADDED Requirements

### Requirement: A Document Accrued At Approval Is Settled Once, With Evidence

The system SHALL record how a document whose type accrues at approval was finally settled, as one `document_settlement` row per document carrying the settlement type, when it happened, the actor who recorded it, and a reference. Recording a settlement SHALL require at least one evidence file, stored as a `document_attachment` of that document, and SHALL write the settlement, the evidence, and its ledger effect together — a settlement without its evidence, or without its ledger entry, SHALL NOT exist.

A document SHALL carry at most one settlement. A second attempt SHALL be rejected rather than replacing the first, because the row records that money left and money does not leave twice. The settlement SHALL be immutable once written; a correction is a new ledger entry, not an edit.

Recording a settlement SHALL require the finance permission that governs recording payments, and SHALL be refused to a request authenticated by an API key regardless of the bound user's grants — declaring that money left is not a machine's act. The prohibition SHALL be enforced on the authentication channel and SHALL NOT be expressible as a grant.

The system SHALL accept `CASH` as a settlement type. Any other value SHALL be refused with an error naming it as not yet supported, rather than being treated as cash.

#### Scenario: Finance records a transfer

- **GIVEN** a fully approved document of a type that accrues at approval
- **WHEN** a user holding the payment-management permission records a `CASH` settlement with a reference, a date, and one evidence file
- **THEN** the settlement is stored with that actor and reference, the file is stored as an attachment of the document, and the document is distinguishable from one still awaiting payment

#### Scenario: The same document cannot be settled twice

- **GIVEN** a document that already has a settlement
- **WHEN** a settlement is recorded for it again
- **THEN** the request is rejected and the stored settlement is unchanged

#### Scenario: Evidence is required

- **WHEN** a settlement is recorded with no file
- **THEN** the request is rejected and no settlement, attachment, or ledger entry is written

#### Scenario: An API key may not settle

- **WHEN** a request authenticated by an API key calls the settlement endpoint, and the bound user holds the payment-management permission
- **THEN** the request is refused

#### Scenario: A document type that does not accrue cannot be settled this way

- **GIVEN** a document of a type that does not accrue at approval
- **WHEN** a settlement is recorded for it
- **THEN** the request is rejected, because there is no payable to clear and its payment belongs to the payment flow

#### Scenario: An unsupported settlement type is named, not assumed

- **WHEN** a settlement is recorded with a type other than `CASH`
- **THEN** the request is rejected with an error naming that type as not yet supported

#### Scenario: Approved but unsettled is answerable

- **GIVEN** documents of an accruing type, some settled and some not
- **WHEN** the unsettled ones are asked for
- **THEN** exactly those without a settlement row are returned
