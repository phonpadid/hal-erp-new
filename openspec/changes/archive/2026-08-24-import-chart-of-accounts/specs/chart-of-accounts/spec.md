## MODIFIED Requirements

### Requirement: Account Type and Hierarchy Integrity

An account's `parent_id`, when set, MUST reference an account in the same company. The
hierarchy MUST NOT contain cycles. An account marked `is_postable = false` represents a
summary/header node and MUST NOT be selectable as a postable GL account.

A parent's `account_type` MAY differ from its child's. Real charts file a contra account under the
head it offsets — an asset under a revenue head, a liability under an asset head — and the
customer's own chart does so in 46 places. Nothing in this system rolls a figure up the account
tree: `account.parent` is read to print a parent's code and to detect a cycle, and by nothing else.
A same-type rule would therefore reject real accounts to protect a rollup that does not exist. If
one is ever built, the constraint belongs to that rollup, not to the tree.

#### Scenario: Parent must be in the same company

- **WHEN** an account is created with a `parent_id` pointing at an account in another company
- **THEN** the creation is rejected

#### Scenario: A contra account may sit under a head of another type

- **WHEN** an `ASSET` account is created with a `parent_id` pointing at a `REVENUE` account
- **THEN** the creation is accepted, and the account keeps the type it was given

#### Scenario: Cycles are rejected

- **WHEN** an update would make an account its own ancestor
- **THEN** the update is rejected
