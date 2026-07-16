## MODIFIED Requirements

### Requirement: Adjustment Document Creation

The system SHALL let an authorized user (`BUDGET_MANAGE`) create a budget adjustment as an
approvable document carrying a single `budget_movement`. The created movement SHALL record the
target `budget`, the `amount` (DECIMAL, never a float), a free-text `reason`, and the direction
(increase or decrease). The system SHALL resolve the adjustment `document_type` for the active
company by its `post_action` — `ADJUST_INCREASE` for an increase, `ADJUST_DECREASE` for a
decrease — and SHALL NOT resolve it by a hardcoded or reserved `code` (configuration over code,
invariant 7). The candidate set SHALL be the active document types of the active company whose
`post_action` matches the direction (invariant 1). Selection SHALL follow: if no candidate
exists, the system SHALL reject the request as "not configured"; if exactly one candidate
exists, the system SHALL use it; if more than one candidate exists, the request SHALL supply a
`documentTypeId` identifying which candidate to use, and the system SHALL reject an ambiguous
request that omits it. When `documentTypeId` is supplied, the system SHALL reject it unless it
identifies an active document type of the active company whose `post_action` matches the
direction. The document's `document_type.post_action` thus determines the direction per
configuration, not hardcoded branching. Creating the document and its movement SHALL occur in
one DB transaction, scoped to the active company, and leave the document in a state that enters
the normal submit → approval flow. The single ADJUST_INCREASE / ADJUST_DECREASE txn SHALL be
written only by the existing post-action on full approval — creation alone SHALL NOT write any
`budget_txn` row (the ledger stays append-only and approval-gated).

#### Scenario: Creating an adjustment yields an approvable document, no ledger write yet

- **WHEN** an authorized user creates an increase adjustment of 200,000 on a budget with a reason
- **THEN** a `document` plus a `budget_movement` (target budget, amount 200,000, the reason,
  direction increase) are created in one transaction
- **AND** no `budget_txn` row exists for that document until it is fully approved

#### Scenario: Direction comes from the document type's post_action

- **WHEN** a decrease adjustment is created and exactly one decrease type is configured
- **THEN** the system resolves the active company's document type whose `post_action` is
  `ADJUST_DECREASE` (regardless of that type's `code`), so on approval the post-action writes a
  single `ADJUST_DECREASE`

#### Scenario: Resolution is by post_action, not by a reserved code

- **GIVEN** the active company's single increase-adjustment type has a company-specific `code`
  (not the seeded `BUDGET_ADJ_INC`) but still has `post_action` `ADJUST_INCREASE`
- **WHEN** an increase adjustment is created
- **THEN** intake resolves that type by its `post_action` and creates the document successfully

#### Scenario: Multiple configured types require an explicit choice

- **GIVEN** the active company has two active types with `post_action` `ADJUST_INCREASE`
- **WHEN** an increase adjustment is created without a `documentTypeId`
- **THEN** the request is rejected as ambiguous and nothing is created
- **WHEN** the same adjustment is created with a `documentTypeId` naming one of those two types
- **THEN** the document is created using the chosen type

#### Scenario: An invalid documentTypeId is rejected

- **GIVEN** a `documentTypeId` that is inactive, in another company, or whose `post_action` does
  not match the adjustment direction
- **WHEN** an adjustment is created with it
- **THEN** the request is rejected and nothing is created

#### Scenario: Missing configured type is rejected

- **GIVEN** the active company has no active type with `post_action` `ADJUST_INCREASE`
- **WHEN** an increase adjustment is created
- **THEN** the request is rejected as "not configured" and no document or movement is created

#### Scenario: Adjustment cannot bypass approval

- **WHEN** an adjustment document is created but not yet fully approved
- **THEN** the budget's derived available balance is unchanged, because no ADJUST txn has been written

### Requirement: Transfer Request Intake

The system SHALL provide an approval-gated intake that creates a budget transfer as an
approvable document. The intake SHALL require `BUDGET_MANAGE`, and on success SHALL create one
`document` of the transfer document type plus one `budget_movement` row (`movement_type`
`TRANSFER`, `from_budget`, `to_budget`, `amount`, `reason`) in a single database transaction,
and SHALL NOT write any `budget_txn` row. The intake SHALL resolve the transfer `document_type`
from the active document types of the active company whose `post_action` is `TRANSFER`
(invariant 1), and SHALL NOT resolve it by a hardcoded or reserved `code` (configuration over
code, invariant 7). Selection SHALL follow: if no such type exists, the intake SHALL reject the
request as "not configured"; if exactly one exists, the intake SHALL use it; if more than one
exists, the request SHALL supply a `documentTypeId` identifying which to use, and the intake
SHALL reject an ambiguous request that omits it. When `documentTypeId` is supplied, the intake
SHALL reject it unless it identifies an active document type of the active company whose
`post_action` is `TRANSFER`. The document number SHALL be allocated under the existing locked
numbering. The paired `TRANSFER_OUT` / `TRANSFER_IN` `budget_txn` rows SHALL be written only
later by the existing post-action on full approval (append-only ledger). Intake SHALL reject,
before creating anything, a transfer whose source and destination are the same budget, whose
source and destination are in different companies or different `fiscal_year`s, or whose `amount`
is not a positive value; both budgets SHALL be resolved company-scoped so a budget outside the
active company is treated as not found.

#### Scenario: Intake creates a document and movement but no ledger row

- **GIVEN** a `BUDGET_MANAGE` user and two budgets in the same company and fiscal year
- **WHEN** they submit a transfer of 100,000 from one budget to the other
- **THEN** a transfer `document` and a `budget_movement` (`TRANSFER`, from/to, 100,000) are created in one transaction
- **AND** no `budget_txn` row is written and neither budget's derived balance changes

#### Scenario: Transfer type is resolved by post_action

- **WHEN** a valid transfer is submitted and exactly one transfer type is configured
- **THEN** the intake resolves the active company's document type whose `post_action` is
  `TRANSFER` (regardless of that type's `code`) and uses it for the created document

#### Scenario: Multiple transfer types require an explicit choice

- **GIVEN** the active company has two active types with `post_action` `TRANSFER`
- **WHEN** a valid transfer is submitted without a `documentTypeId`
- **THEN** the request is rejected as ambiguous and nothing is created
- **WHEN** the same transfer is submitted with a `documentTypeId` naming one of those types
- **THEN** the document is created using the chosen type

#### Scenario: Missing configured transfer type is rejected

- **GIVEN** the active company has no active type with `post_action` `TRANSFER`
- **WHEN** a valid transfer is submitted to the intake
- **THEN** the request is rejected as "not configured" and nothing is created

#### Scenario: Intake rejects a cross-company transfer

- **GIVEN** a source budget in company A and a destination budget in company B
- **WHEN** a transfer between them is submitted to the intake
- **THEN** the request is rejected before any document or movement is created

#### Scenario: Intake rejects a same-budget or non-positive transfer

- **WHEN** the source and destination budget are the same, or the amount is zero or negative
- **THEN** the request is rejected with a validation error and nothing is created

#### Scenario: Intake is permission-gated

- **WHEN** a request without `BUDGET_MANAGE` calls the transfer intake
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: Full approval writes the paired ledger rows

- **GIVEN** a transfer document created by the intake
- **WHEN** the document is fully approved
- **THEN** the existing post-action writes `TRANSFER_OUT` on the source and `TRANSFER_IN` on the destination atomically, with both budgets locked

## ADDED Requirements

### Requirement: Selectable Movement Document Types

The system SHALL expose a read, authorized by `BUDGET_MANAGE`, that returns the document types a
user may choose when creating a budget movement in the active company. The read SHALL group the
active document types by operation: those with `post_action` `ADJUST_INCREASE`, those with
`ADJUST_DECREASE`, and those with `TRANSFER`. For each type it SHALL return only selection
fields — its `id`, `code`, and `name` — and SHALL be scoped to the active company (invariant 1),
returning only active types. The read SHALL exist so a client can decide whether to prompt the
creator to choose a type (more than one) or proceed without prompting (zero or one).

#### Scenario: Read returns movement types grouped by operation

- **GIVEN** a `BUDGET_MANAGE` user in a company with one increase type, one decrease type, and
  two transfer types configured and active
- **WHEN** they request the selectable movement document types
- **THEN** the response groups them by operation, listing `id`, `code`, and `name` per type,
  with two entries under the transfer group

#### Scenario: Read is company-scoped and active-only

- **GIVEN** an inactive adjustment type and a type belonging to another company
- **WHEN** the selectable movement document types are read
- **THEN** neither the inactive type nor the other company's type appears

#### Scenario: Read is permission-gated

- **WHEN** a request without `BUDGET_MANAGE` calls the read
- **THEN** it is rejected with 403 before the handler runs
