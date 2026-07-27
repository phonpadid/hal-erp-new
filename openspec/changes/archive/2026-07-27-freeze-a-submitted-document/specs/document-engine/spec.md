## ADDED Requirements

### Requirement: A Submitted Document's Contents Are Immutable

The system SHALL reject any change to a document's field values or line items once the document has left `DRAFT`, so that what an approver signed is what takes effect. The refusal SHALL carry the invalid-state code, so a caller can tell it from a malformed payload, and its message SHALL name the only supported way to change a submitted document: return it to `DRAFT`, which costs a fresh trip through every approval step.

A document returned to `DRAFT` SHALL become editable again. Attachments SHALL remain writable at any status — evidence added while a document waits for a signature does not change what the document says.

#### Scenario: Field values cannot be changed under approval

- **GIVEN** a document in `IN_APPROVAL`
- **WHEN** its field values are written
- **THEN** the request is rejected with the invalid-state code and the stored values are unchanged

#### Scenario: Lines cannot be changed after approval

- **GIVEN** a fully approved document
- **WHEN** its lines are written
- **THEN** the request is rejected and the stored lines are unchanged

#### Scenario: A draft is still editable

- **GIVEN** a document in `DRAFT`
- **WHEN** its field values and lines are written
- **THEN** both are accepted, exactly as before

#### Scenario: Returning a document makes it editable again

- **GIVEN** a document an approver returned, which is therefore back in `DRAFT`
- **WHEN** its field values are written
- **THEN** the write is accepted, and submitting it again routes through the approval chain from its first step

#### Scenario: Evidence may still be attached while waiting for a signature

- **GIVEN** a document in `IN_APPROVAL`
- **WHEN** an attachment is uploaded to it
- **THEN** the upload is accepted, because evidence does not change what was approved
