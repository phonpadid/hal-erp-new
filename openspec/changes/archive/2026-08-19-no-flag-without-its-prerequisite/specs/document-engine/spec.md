# document-engine

## ADDED Requirements

### Requirement: A Document Type's Flags Must Have What They Depend On

The system SHALL refuse to save an active `document_type` whose flags leave unmet a dependency on
another flag of the same row — several flags mean nothing unless another is set a particular way. Each refusal
SHALL name the flag that is missing rather than the one that is present, because the fix is far more
often to add the prerequisite than to remove what depends on it.

The rules SHALL be decided from the type's own row — no query, no reference graph, no knowledge of
who will submit — and SHALL be applied to the resulting state of a create or an update, so that
removing a prerequisite is refused as surely as never setting one. They SHALL bind only while the
type is active: an inactive type raises no documents, and activating it re-applies them.

**A type requiring a payee SHALL require a vendor.** A payee is a vendor's bank account: the
submit check refuses a payee that does not belong to the document's vendor, and the client's picker
is loaded from the vendor. Without the vendor the required field can never be filled and every
submit is refused for something the user was given no way to supply.

**A type whose post-action moves stock SHALL require a warehouse.** Stock moves out of somewhere,
and for a transfer into somewhere else. Every check that establishes those — the source, the
destination, and that the two differ — is conditional on the warehouse requirement, so without it
they are not merely inapplicable but skipped, and the movement proceeds against a warehouse that was
never named. Which post-actions move stock SHALL be taken from the declared set rather than from a
list of document-type codes (invariant 7), and SHALL include the adjustment action: an adjustment
reserves nothing but must still say which shelf it corrects.

**A type recognising its expense at approval SHALL have a source for the charge** — either its own
budget, or a vendor. The accrual reads the document's `ACTUAL` budget rows; a document naming a
vendor follows its reference chain to the ancestor that was charged, and one without reads its own.
A type that neither reserves budget nor names a vendor has neither source, so its accrual can only
ever record a terminal skip: the document is approved and its books say nothing happened.

Having a vendor SHALL be sufficient for that rule. Whether the chain actually reaches a predecessor
that reserved is a question about the configured reference pairings, not about this row, and SHALL
NOT be decided here.

#### Scenario: A payee requirement without a vendor requirement is refused

- **WHEN** an active type is saved requiring a payee but not a vendor
- **THEN** the save is rejected, naming the vendor requirement as what is missing

#### Scenario: Requiring both is accepted

- **WHEN** an active type is saved requiring both a payee and a vendor
- **THEN** the save succeeds

#### Scenario: A stock-moving type without a warehouse requirement is refused

- **WHEN** an active type is saved whose post-action issues, adjusts or transfers stock, without
  requiring a warehouse
- **THEN** the save is rejected, naming the warehouse requirement

#### Scenario: A non-stock type needs no warehouse

- **WHEN** an active type is saved with a post-action that does not move stock and no warehouse
  requirement
- **THEN** the save succeeds

#### Scenario: An accruing type with neither budget nor vendor is refused

- **WHEN** an active type is saved that recognises its expense at approval while requiring neither
  budget nor a vendor
- **THEN** the save is rejected, naming both of the sources it could have had

#### Scenario: An accruing type with its own budget is accepted

- **WHEN** an active type is saved that recognises its expense at approval and requires budget
- **THEN** the save succeeds

#### Scenario: An accruing type with a vendor is accepted

- **WHEN** an active type is saved that recognises its expense at approval and requires a vendor,
  without requiring budget of its own
- **THEN** the save succeeds, because the charge is carried by its reference chain

#### Scenario: Removing a prerequisite is refused like never having it

- **GIVEN** an active type requiring both a payee and a vendor
- **WHEN** the vendor requirement is removed
- **THEN** the update is rejected

#### Scenario: An inactive type is not held to the rules

- **WHEN** an inactive type is saved with any of these dependencies unmet
- **THEN** the save succeeds, and activating it later is rejected
