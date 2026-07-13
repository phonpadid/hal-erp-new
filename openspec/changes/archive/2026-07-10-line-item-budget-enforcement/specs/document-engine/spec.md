## MODIFIED Requirements

### Requirement: Configurable Document Type
The system SHALL define document types in `document_type` with `requires_budget`,
`requires_quota`, `requires_item`, and `post_action`, so behavior is configured, not
hardcoded. `requires_item` defaults to `false`; when `true`, every line of a document of
that type MUST carry an `item_id`.

#### Scenario: A non-budget type skips budget steps
- GIVEN a document type with requires_budget=false and requires_quota=false
- WHEN a document of that type is submitted
- THEN no budget or quota transactions are created
- AND the document still enters its approval workflow

#### Scenario: requires_item defaults off for existing types
- GIVEN a document type created without specifying `requires_item`
- WHEN a document of that type is submitted with a free-text (item-less) line
- THEN the submit is not rejected for a missing item

## ADDED Requirements

### Requirement: Mandatory Item on Configured Types
When a document's type has `requires_item = true`, the system SHALL reject submit if any
document line has no `item_id`, identifying the offending line, and SHALL leave the document
DRAFT with no budget or quota reserved. A draft MAY be saved with item-less lines; the rule
is enforced at submit (mirroring the `requires_vendor` completeness gate).

#### Scenario: Item-mandatory type rejects a free-text line at submit
- **GIVEN** a document type with `requires_item = true`
- **WHEN** a document of that type is submitted with a line that has no `item_id`
- **THEN** the submit is rejected identifying the line, and the document stays DRAFT

#### Scenario: Item-mandatory type accepts lines that all carry an item
- **GIVEN** a document type with `requires_item = true`
- **WHEN** a document of that type is submitted with every line carrying an `item_id`
- **THEN** the submit is not rejected for a missing item

#### Scenario: A draft may still hold an item-less line
- **GIVEN** a document type with `requires_item = true`
- **WHEN** a requester saves a draft with an item-less line
- **THEN** the draft is saved, and only submit enforces the item requirement

### Requirement: Complete Budget Coverage on Submit
On a document whose type has `requires_budget = true`, the system SHALL reject submit when
any line with a positive `line_amount` has no resolved `budget_id`, identifying the
offending line, and SHALL leave the document DRAFT with no budget reserved. A line with a
zero `line_amount` reserves nothing and is not required to carry a budget. This replaces any
weaker rule that only rejected a budget-controlled document with no budgeted line at all.

#### Scenario: A positive budget-less line is rejected
- **GIVEN** a `requires_budget` document with one budgeted line and one line whose
  `line_amount` is positive but which resolves no budget
- **WHEN** the document is submitted
- **THEN** the submit is rejected identifying the budget-less line, and the document stays
  DRAFT with no RESERVE created for any line

#### Scenario: Every positive line has a budget
- **GIVEN** a `requires_budget` document where every positive-amount line resolves a budget
- **WHEN** the document is submitted
- **THEN** the submit proceeds and one RESERVE is created per line's budget

#### Scenario: A zero-amount line need not carry a budget
- **GIVEN** a `requires_budget` document with budgeted positive lines and one zero-amount
  line that resolves no budget
- **WHEN** the document is submitted
- **THEN** the submit is not rejected for the zero-amount line, which reserves nothing
