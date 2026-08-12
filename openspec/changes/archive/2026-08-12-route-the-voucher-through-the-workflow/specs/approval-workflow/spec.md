# approval-workflow

## ADDED Requirements

### Requirement: A POST_JOURNAL Type Posts Its Voucher On Full Approval

The system SHALL support a `POST_JOURNAL` post-action: on full approval of a document of a type
carrying it, the journal voucher the document holds SHALL be posted through the same balanced entry
constructor every other posting uses.

The entry SHALL be dated the voucher's own accounting date, authored by the document's creator, and
keyed so that a retried approval resolves to the entry already written.

A `POST_JOURNAL` document SHALL write no `budget_txn` and SHALL NOT be marked payment-ready. An
accountant correcting the ledger is neither spending a budget nor asking for money to be sent.

Posting SHALL be driven by the post-action alone, not by the document type's code. Which types post
journals is configuration (invariant 7).

#### Scenario: Full approval posts the voucher

- **GIVEN** a document of a `POST_JOURNAL` type whose voucher balances
- **WHEN** its last applicable step approves
- **THEN** one balanced entry exists, dated the voucher's date and authored by the document's creator

#### Scenario: A partial approval posts nothing

- **GIVEN** a `POST_JOURNAL` document with more than one applicable step
- **WHEN** only the first step approves
- **THEN** no entry exists

#### Scenario: It reserves nothing and asks for no payment

- **WHEN** a `POST_JOURNAL` document completes
- **THEN** no `budget_txn` row is written and no payment-ready event is raised

### Requirement: An Approval That Could Not Post Is Refused Before It Is Recorded

Where a document's post-action writes to the ledger, the system SHALL check that the entry's
accounting date falls in an open period BEFORE recording the approval, and SHALL refuse the approval
naming the period when it does not.

Without this the check happens inside the approval transaction, at the moment of posting. On a route
of one step that is merely inconvenient; on a longer route it is a defect: every approver but the
last has already approved, and the last one's action is rolled back with an error about a period they
did not choose and cannot open, leaving the document at a step whose approval can never commit.

The refusal SHALL leave no approval-log row, because no approval happened, and SHALL say that the
fix belongs to the document's author — withdraw and re-date — rather than to the approver.

This SHALL NOT replace the check inside the posting constructor, which remains the invariant. A
period can close between the check and the commit; what this removes is the ordinary case, not the
race.

#### Scenario: An approval into a closed period is refused

- **GIVEN** a document whose posting date falls in a period that closed while it waited
- **WHEN** an approver approves it
- **THEN** it is refused naming the period, no entry is written, and no approval-log row is added

#### Scenario: The refusal names who can fix it

- **WHEN** such an approval is refused
- **THEN** the message says the author must withdraw and re-date it

#### Scenario: An open period approves normally

- **GIVEN** the same document dated in an open period
- **WHEN** an approver approves it
- **THEN** the approval is recorded
