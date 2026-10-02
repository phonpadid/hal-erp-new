## MODIFIED Requirements

### Requirement: Locked Rate on Document
The system SHALL store the resolved rate on the document at submit time and MUST NOT
recompute it later from current rates.

It MAY be restated once or more by a person while the document is still refusable — see
`payment-handoff`'s *Finance States the Document's Rate*. That is the only way it changes. A rate
table edited afterwards SHALL NOT reach a document that is already submitted, whether or not anyone
has restated it: the document holds its own figure, and only a person acting on that document can
move it.

The distinction is what the requirement protects. A rate recomputed from a table changes documents
nobody is looking at, silently and in bulk. A rate restated by the person who converted the money
changes one document, is attributed to them, and is still subject to an approval nobody has given
yet.

#### Scenario: Later rate change does not move the document
- GIVEN a submitted document with a locked rate
- WHEN the daily rate changes the next day
- THEN the document's converted amount stays unchanged

#### Scenario: A later rate change does not move a restated document either
- **GIVEN** a document whose rate a person restated
- **WHEN** the rate table gains a newer row for the same pair
- **THEN** the document keeps the figure the person stated

#### Scenario: Nothing recomputes a document that can no longer be refused
- **GIVEN** a document that has passed its last approval
- **WHEN** any rate — in the table or stated by a person — differs from its locked rate
- **THEN** the document's rate and converted amounts stay exactly as approved
