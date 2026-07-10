## ADDED Requirements

### Requirement: Item-Driven GL and Budget Resolution on Lines

When a document line references an `item`, the system SHALL derive the line's
`gl_account` from that item's `default_gl_account` **server-authoritatively**, ignoring any
`gl_account` value supplied by the client. From the derived `gl_account`, the document's
`department_id`, and the fiscal year whose `start_date`/`end_date` contains the document
date, the system SHALL resolve the line's `budget_id` to the single `budget` uniquely
identified by `(fiscal_year_id, department_id, gl_account)` whose `status` is `ACTIVE`.
All lookups (item, fiscal year, budget) SHALL be scoped to the document's `company_id`
(invariant 1).

For a document type where `requires_budget` is true, the system SHALL reject line save or
submit when an item-backed line's item has **no** `default_gl_account`, or when **no**
`ACTIVE` budget matches the resolved `(fiscal_year, department, gl_account)`; the error
SHALL name the `gl_account`, department, and fiscal year that failed to resolve. A line
that carries no item SHALL fall back to an explicitly selected `budget_id` (the selectable
budgets read); such a line is not subject to item-GL derivation.

This requirement changes only how a line's `gl_account` and `budget_id` are chosen. It does
not change budget reservation, conversion, or release (invariants 3–5), which continue to
act on the resolved `budget_id`.

#### Scenario: Item derives GL and resolves the budget

- **GIVEN** a `requires_budget` document in a department, with an item whose
  `default_gl_account` is `5210` and an `ACTIVE` budget for that fiscal year, department,
  and `5210`
- **WHEN** the requester adds a line referencing that item
- **THEN** the line's `gl_account` is set to `5210` and its `budget_id` is set to the
  matching budget, without the requester choosing a GL or a budget

#### Scenario: Client-supplied GL on an item line is ignored

- **GIVEN** an item-backed line whose item defaults to `gl_account` `5210`
- **WHEN** the client sends a different `gl_account` on save
- **THEN** the server overwrites it with the item's `default_gl_account` and resolves the
  budget from that value

#### Scenario: Item without a default GL is rejected on a budget-required type

- **GIVEN** a `requires_budget` document and an item that has no `default_gl_account`
- **WHEN** the requester tries to save or submit a line referencing that item
- **THEN** the operation is rejected with an error identifying the item as having no GL,
  and no budget is resolved

#### Scenario: No matching active budget is rejected

- **GIVEN** an item whose `default_gl_account` is `5210` but no `ACTIVE` budget exists for
  the document's fiscal year, department, and `5210`
- **WHEN** the requester tries to save or submit that line
- **THEN** the operation is rejected with an error naming the `gl_account`, department, and
  fiscal year, and the line is not saved

#### Scenario: Item-less line uses an explicitly selected budget

- **GIVEN** a `requires_budget` document line that references no item
- **WHEN** the requester selects a budget from the selectable-budgets read and saves
- **THEN** the line stores that `budget_id` and no item-GL derivation is applied

#### Scenario: Resolution is company-scoped

- **WHEN** a line's item, fiscal year, and budget are resolved while company A is active
- **THEN** only company A's item enablement, fiscal year, and budget are considered, and no
  other company's budget can be resolved onto the line
