## ADDED Requirements

### Requirement: Adjustment Document Creation

The system SHALL let an authorized user (`BUDGET_MANAGE`) create a budget adjustment as an
approvable document carrying a single `budget_movement`. The created movement SHALL record the
target `budget`, the `amount` (DECIMAL, never a float), a free-text `reason`, and the direction
(increase or decrease); the document's `document_type.post_action` SHALL determine the direction
(`ADJUST_INCREASE` / `ADJUST_DECREASE`) per configuration, not hardcoded branching. Creating the
document and its movement SHALL occur in one DB transaction, scoped to the active company, and
leave the document in a state that enters the normal submit → approval flow. The single
ADJUST_INCREASE / ADJUST_DECREASE txn SHALL be written only by the existing post-action on full
approval — creation alone SHALL NOT write any `budget_txn` row (the ledger stays append-only and
approval-gated).

#### Scenario: Creating an adjustment yields an approvable document, no ledger write yet

- **WHEN** an authorized user creates an increase adjustment of 200,000 on a budget with a reason
- **THEN** a `document` plus a `budget_movement` (target budget, amount 200,000, the reason,
  direction increase) are created in one transaction
- **AND** no `budget_txn` row exists for that document until it is fully approved

#### Scenario: Direction comes from the document type's post_action

- **WHEN** a decrease adjustment is created
- **THEN** the document uses the adjustment type whose `post_action` is `ADJUST_DECREASE`, so on
  approval the post-action writes a single `ADJUST_DECREASE`

#### Scenario: Adjustment cannot bypass approval

- **WHEN** an adjustment document is created but not yet fully approved
- **THEN** the budget's derived available balance is unchanged, because no ADJUST txn has been written
