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
SHALL NOT create budget or quota holds.

#### Scenario: PO links to its PR
- GIVEN an approved PR
- WHEN a PO is created from it
- THEN the PO's `ref_document_id` points to the PR

#### Scenario: Create-from copies header and lines
- GIVEN an `APPROVED` predecessor with multiple `document_line` rows
- WHEN a user creates a successor from it
- THEN a `DRAFT` successor is created with the header fields and lines copied, and no `budget_txn` or `quota_usage` rows are written

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

## ADDED Requirements

### Requirement: Reference-Chain Pairing Configuration
The system SHALL store allowed predecessor→successor document-type pairings as
`document_type_ref` rows, each scoped to a single company via `company_id`. Both
`predecessor_type_id` and `successor_type_id` SHALL reference `document_type` rows
belonging to the same company as the pairing; the system SHALL reject any attempt to
create a pairing whose two types are not both in that company. The combination
(`company_id`, `predecessor_type_id`, `successor_type_id`) SHALL be unique. Reference-chain
lookups (create-from validation and `CREATE_PO` successor resolution) SHALL read these rows
scoped to the active company and MUST NOT rely on any hardcoded pairing table. The
`CREATE_PO` post-action SHALL auto-create a successor only when exactly one successor type
resolves from `document_type_ref` for the source type.

#### Scenario: Pairing requires same-company types
- GIVEN a predecessor type in company A and a successor type in company B
- WHEN an admin attempts to create a `document_type_ref` pairing between them
- THEN the request is rejected and no pairing row is written

#### Scenario: Duplicate pairing is rejected
- GIVEN a `document_type_ref` pairing PR→PO already exists in a company
- WHEN an admin attempts to create the same PR→PO pairing again in that company
- THEN the request is rejected as a duplicate

#### Scenario: CREATE_PO auto-creates only on a single successor
- GIVEN an approved PR whose type resolves to exactly one successor type (PO) via `document_type_ref`
- WHEN the `CREATE_PO` post-action runs
- THEN a DRAFT PO referencing the PR is created

#### Scenario: CREATE_PO is a no-op when successors are ambiguous or absent
- GIVEN an approved document whose type resolves to zero or more than one successor type via `document_type_ref`
- WHEN the `CREATE_PO` post-action runs
- THEN it does nothing (logged) and the approval still completes
