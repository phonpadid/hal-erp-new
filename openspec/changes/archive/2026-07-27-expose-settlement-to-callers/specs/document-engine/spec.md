## ADDED Requirements

### Requirement: A Settled Document Can Be Read Back As Settled

A caller entitled to read a document SHALL be able to read whether it has been settled, receiving the settlement type, the date the money left, and the reference recorded with it. A document with no settlement SHALL answer as not found rather than as a settlement whose fields are empty. The read SHALL be scoped to the active company like every other document read, and SHALL require the same permission reading the document requires.

The read SHALL NOT expose the evidence attached to the settlement, nor the person who recorded it, nor the note: those are internal accountability records, and the contract carries only what a caller needs to close its own case.

Existing document reads SHALL be unchanged by this — a caller that does not ask for the settlement SHALL receive exactly what it received before.

#### Scenario: A settled document reports its settlement

- **GIVEN** a document settled with a type, a date and a reference
- **WHEN** its settlement is read
- **THEN** those three values are returned

#### Scenario: An unsettled document has no settlement to report

- **GIVEN** a fully approved document that has not been settled
- **WHEN** its settlement is read
- **THEN** the response is not found, rather than a settlement with empty fields

#### Scenario: The internal record stays internal

- **WHEN** a settlement is read
- **THEN** the response carries no evidence file, no recording user, and no note

#### Scenario: Another company's document is not readable

- **WHEN** a caller reads the settlement of a document belonging to another company
- **THEN** the response is not found

#### Scenario: The existing document read is untouched

- **WHEN** a caller reads a document the way it did before this requirement existed
- **THEN** the response is identical, whether or not the document has been settled
