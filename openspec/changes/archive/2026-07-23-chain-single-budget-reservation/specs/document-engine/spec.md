## MODIFIED Requirements

### Requirement: Document Reference Chain
The system SHALL allow a document to reference a predecessor via `ref_document_id`
(e.g. PO references PR, advance-clearing references advance). When `ref_document_id` is set, the
system SHALL resolve the predecessor **within the active company** — a predecessor belonging to
another company SHALL resolve as not-found — SHALL require the predecessor's `status` to be
`APPROVED` or `COMPLETED`, and SHALL require the predecessor-type → new-type pairing to be
permitted by a `document_type_ref` row in the active company (configuration, not hardcoded per
type). The system SHALL provide a create-from-predecessor action that issues a `DRAFT` of the
target type with header fields and `document_line` rows copied from the predecessor; the copy
SHALL NOT create budget or quota holds. Each copied line SHALL carry the predecessor line's
`budget_id` and `tax_code_id`, so the successor charges the same budget and computes the same VAT
as the line it descends from. `gl_account` SHALL NOT be copied: it is re-derived from the item or
the chosen budget at write time, so the successor reflects the current configuration rather than a
stale stamp.

#### Scenario: PO links to its PR
- GIVEN an approved PR
- WHEN a PO is created from it
- THEN the PO's `ref_document_id` points to the PR

#### Scenario: Create-from copies header and lines
- GIVEN an `APPROVED` predecessor with multiple `document_line` rows
- WHEN a user creates a successor from it
- THEN a `DRAFT` successor is created with the header fields and lines copied, and no `budget_txn` or `quota_usage` rows are written

#### Scenario: Create-from carries the line tax code
- GIVEN an `APPROVED` predecessor whose line carries a VAT `tax_code_id`
- WHEN a successor is created from it and submitted
- THEN the successor's line carries the same `tax_code_id`
- AND the successor's `tax_total` and `grand_total` equal the predecessor's for the same line amount

#### Scenario: Referencing an unapproved predecessor is rejected
- GIVEN a predecessor whose `status` is `DRAFT` or `SUBMITTED`
- WHEN a document is created referencing it
- THEN the request is rejected with a validation error

#### Scenario: Cross-company predecessor is not-found
- WHEN a user references a predecessor `:id` that belongs to a different company
- THEN the request resolves as not-found (404) and no `document` is created

#### Scenario: Disallowed type pairing is rejected
- GIVEN no `document_type_ref` row in the active company permits the predecessor-type → target-type pairing
- WHEN a create-from is attempted across that pairing
- THEN the request is rejected with a validation error

#### Scenario: Pairing is resolved within the active company only
- GIVEN a `document_type_ref` pairing PR→PO exists in company A but not in company B
- WHEN a user in company B attempts to create a PO from a PR
- THEN the request is rejected with a validation error, because the pairing is not configured for company B
