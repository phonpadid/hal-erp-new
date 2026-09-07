## ADDED Requirements

### Requirement: Content Held Outside The Document's Lines Is Readable Through The Document

The document read SHALL return the content a document carries outside `document_line` and
`doc_field_value`. For a document whose `post_action` moves budget, that is its `budget_movement`
rows: the movement type, the budget each names, and the amount.

A document that carries no such content SHALL return none, and a reader SHALL be able to tell "this
document has no movements" from "this document's movements were not read".

"A Document Type Declares Where Its Content Is Authored" solves the writing half of this split: it
sends the requester to the screen that can author content the generic form cannot reach. This
requirement is its mirror. Without it, the content is written and then invisible — a budget plan
reads as a document with nothing in it, and the person approving it is told an amount and not where
it lands.

The read SHALL be scoped to the active company like every other document read (invariant 1): a
movement names a budget, and a budget of another company SHALL NOT be resolvable through it.

#### Scenario: A budget plan states the budget it activates

- **GIVEN** a document whose `post_action` is `ACTIVATE_BUDGET`, carrying one `budget_movement` for
  a budget of 12,000,000
- **WHEN** the document is read
- **THEN** it reports that movement, naming the budget and the amount

#### Scenario: An adjustment states which budget it moves and by how much

- **GIVEN** a document whose `post_action` is `ADJUST_INCREASE`, carrying a movement of 65,004,000
- **WHEN** the document is read
- **THEN** it reports the movement type, the budget, and 65,004,000

#### Scenario: An ordinary document reports no movements

- **GIVEN** a disbursement whose content is document lines
- **WHEN** it is read
- **THEN** it reports no budget movements, and its lines as before

#### Scenario: A movement never resolves another company's budget

- **GIVEN** a document of company A
- **WHEN** its movements are read in the context of company B
- **THEN** the document is not resolvable, exactly as its other reads are not
