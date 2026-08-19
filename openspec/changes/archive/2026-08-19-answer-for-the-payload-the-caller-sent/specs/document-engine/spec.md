# document-engine

## MODIFIED Requirements

### Requirement: Mandatory Item on Configured Types

When a document's type has `requires_item = true`, the system SHALL reject submit if the document has no lines at all, or if any line has no `item_id`, identifying the offending line where there is one, and SHALL leave the document DRAFT with no budget or quota reserved. A draft MAY be saved with item-less lines, or with none; the rule is enforced at submit (mirroring the `requires_vendor` completeness gate).

The empty case SHALL be rejected explicitly. A rule that every line carries an item is satisfied by a document with no lines, which is not what the flag asks: a type configured to require items exists to move or account for the things named on those lines, and a submitted document naming none of them consumes an approval chain to authorise nothing.

This SHALL NOT become a general requirement that a document has lines. A type that requires no items MAY still be submitted without any.

#### Scenario: Item-mandatory type rejects a free-text line at submit
- **GIVEN** a document type with `requires_item = true`
- **WHEN** a document of that type is submitted with a line that has no `item_id`
- **THEN** the submit is rejected identifying the line, and the document stays DRAFT

#### Scenario: Item-mandatory type rejects a document with no lines
- **GIVEN** a document type with `requires_item = true`
- **WHEN** a document of that type is submitted with no lines
- **THEN** the submit is rejected, and the document stays DRAFT with nothing reserved

#### Scenario: Item-mandatory type accepts lines that all carry an item
- **GIVEN** a document type with `requires_item = true`
- **WHEN** a document of that type is submitted with every line carrying an `item_id`
- **THEN** the submit is not rejected for a missing item

#### Scenario: A type that requires no items may still be submitted without lines
- **GIVEN** a document type with `requires_item = false`
- **WHEN** a document of that type is submitted with no lines
- **THEN** it is not rejected for having none

#### Scenario: A draft may still hold an item-less line
- **GIVEN** a document type with `requires_item = true`
- **WHEN** a requester saves a draft with an item-less line
- **THEN** the draft is saved, and only submit enforces the item requirement
