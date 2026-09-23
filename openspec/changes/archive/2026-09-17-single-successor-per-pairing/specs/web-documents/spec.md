## ADDED Requirements

### Requirement: Create Successor Is Offered Only For An Open Pairing

On the document detail screen the create-successor affordance SHALL offer only successor types
for which the document has no live successor, as reported by the detail's `successors` list. When
every configured pairing is taken the affordance SHALL be hidden. The screen SHALL show each live
successor as a link to that document with its `doc_no` and status, so a user who cannot create a
`PO` can see the one that exists. A server refusal (400 already-exists or 409 lost the race) SHALL
be surfaced as an error and the detail re-read so the new successor appears. The client rule is
UX only; the server still enforces.

#### Scenario: A taken pairing is not offered
- **GIVEN** an `APPROVED` `PR` whose detail lists a live `PO`
- **WHEN** a `DOC_CREATE` user views it
- **THEN** `PO` is not offered as a successor type and the existing `PO` is shown as a link

#### Scenario: A freed pairing is offered again
- **GIVEN** a `PR` whose only `PO` is `CANCELLED`
- **WHEN** the user views the `PR`
- **THEN** `PO` is offered as a successor type

#### Scenario: Losing the race is surfaced
- **GIVEN** a user whose create-from is refused by the server because a successor now exists
- **WHEN** the refusal arrives
- **THEN** the error is shown and the detail re-reads, listing the successor that won
