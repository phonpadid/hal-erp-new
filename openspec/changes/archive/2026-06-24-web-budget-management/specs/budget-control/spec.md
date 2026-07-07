## ADDED Requirements

### Requirement: Transfer Request Intake

The system SHALL provide an approval-gated intake that creates a budget transfer as an
approvable document. The intake SHALL require `BUDGET_MANAGE`, and on success SHALL create one
`document` of the transfer document type (whose `post_action` is `TRANSFER`) plus one
`budget_movement` row (`movement_type` `TRANSFER`, `from_budget`, `to_budget`, `amount`,
`reason`) in a single database transaction, and SHALL NOT write any `budget_txn` row. The
document number SHALL be allocated under the existing locked numbering. The paired
`TRANSFER_OUT` / `TRANSFER_IN` `budget_txn` rows SHALL be written only later by the existing
post-action on full approval (append-only ledger). Intake SHALL reject, before creating
anything, a transfer whose source and destination are the same budget, whose source and
destination are in different companies or different `fiscal_year`s, or whose `amount` is not a
positive value; both budgets SHALL be resolved company-scoped so a budget outside the active
company is treated as not found.

#### Scenario: Intake creates a document and movement but no ledger row

- **GIVEN** a `BUDGET_MANAGE` user and two budgets in the same company and fiscal year
- **WHEN** they submit a transfer of 100,000 from one budget to the other
- **THEN** a transfer `document` and a `budget_movement` (`TRANSFER`, from/to, 100,000) are created in one transaction
- **AND** no `budget_txn` row is written and neither budget's derived balance changes

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
