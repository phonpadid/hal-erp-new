## MODIFIED Requirements

### Requirement: Item-Driven GL and Budget Resolution on Lines

When a document line references an `item`, the system SHALL derive the line's
`gl_account` from that item's **per-company GL — the active company's
`item_company.default_gl_account`** — server-authoritatively, ignoring any `gl_account` value
supplied by the client. From the derived `gl_account`, the document's `department_id`, and the
fiscal year whose `start_date`/`end_date` contains the document date, the system SHALL resolve
the line's `budget_id` to the single `budget` uniquely identified by
`(fiscal_year_id, department_id, gl_account)` whose `status` is `ACTIVE`. All lookups (item
enablement, fiscal year, budget) SHALL be scoped to the document's `company_id` (invariant 1).
The group `item` table carries no GL.

For a document type where `requires_budget` is true, the system SHALL reject line save or
submit when an item-backed line's item has **no `item_company.default_gl_account`** for the
active company, or when **no** `ACTIVE` budget matches the resolved
`(fiscal_year, department, gl_account)`; the error SHALL name the `gl_account`, department, and
fiscal year that failed to resolve.

A line that carries **no item** SHALL resolve its budget in this precedence: (1) an
explicitly selected `budget_id` wins and stamps the line's `gl_account` from that budget;
(2) otherwise, when the document's type sets a `default_gl_account`, the line's `gl_account`
is stamped from that type default and its `budget_id` is resolved **best-effort** from
`(fiscal_year, department, default_gl_account)` — an `ACTIVE` match is charged, and no match
simply leaves the line's budget unset (it is NOT rejected, unlike an item-backed line);
(3) otherwise the line carries no GL/budget from derivation. The submit-time budget-coverage
rule still applies to a positive-amount line.

This requirement changes only how a line's `gl_account` and `budget_id` are chosen. It does
not change budget reservation, conversion, or release (invariants 3–5), which continue to
act on the resolved `budget_id`.

#### Scenario: Item derives GL and resolves the budget

- **GIVEN** a `requires_budget` document in a department, with an item whose active-company
  `item_company.default_gl_account` is `5210` and an `ACTIVE` budget for that fiscal year,
  department, and `5210`
- **WHEN** the requester adds a line referencing that item
- **THEN** the line's `gl_account` is set to `5210` and its `budget_id` is set to the
  matching budget, without the requester choosing a GL or a budget

#### Scenario: Client-supplied GL on an item line is ignored

- **GIVEN** an item-backed line whose item's per-company GL is `5210`
- **WHEN** the client sends a different `gl_account` on save
- **THEN** the server overwrites it with the item's per-company GL and resolves the budget
  from that value

#### Scenario: Item without a per-company GL is rejected on a budget-required type

- **GIVEN** a `requires_budget` document and an item with no `item_company.default_gl_account`
  for the active company
- **WHEN** the requester tries to save or submit a line referencing that item
- **THEN** the operation is rejected with an error identifying the item as having no GL,
  and no budget is resolved

#### Scenario: No matching active budget is rejected for an item line

- **GIVEN** an item whose per-company GL is `5210` but no `ACTIVE` budget exists for
  the document's fiscal year, department, and `5210`
- **WHEN** the requester tries to save or submit that line
- **THEN** the operation is rejected with an error naming the `gl_account`, department, and
  fiscal year, and the line is not saved

#### Scenario: Item GL is company-scoped

- **GIVEN** an item whose `item_company.default_gl_account` is `5300` in company A and `5210`
  in company B
- **WHEN** an item line referencing it is created while company B is active
- **THEN** the line's `gl_account` is `5210` (company B's value), and company A's `5300` is
  never used

#### Scenario: Type default GL resolves an item-less line's budget

- **GIVEN** a `requires_budget` type whose `default_gl_account` is `5210`, and an `ACTIVE`
  budget for the document's fiscal year, department, and `5210`
- **WHEN** the requester adds a line with no item and no chosen budget
- **THEN** the line's `gl_account` is set to `5210` and its `budget_id` is resolved to that
  budget, without the requester picking a budget

#### Scenario: Explicit budget overrides the type default

- **GIVEN** a `requires_budget` type with a `default_gl_account`, and an item-less line for
  which the requester chose a different budget
- **WHEN** the line is saved
- **THEN** the chosen `budget_id` is used and the line's `gl_account` is stamped from that
  budget, not from the type default

#### Scenario: Unresolved type default degrades to the picker, not a rejection

- **GIVEN** a `requires_budget` type whose `default_gl_account` has no `ACTIVE` budget for the
  document's department and year
- **WHEN** the requester saves an item-less line with no chosen budget
- **THEN** the save is not rejected; the line carries the type-default `gl_account` with no
  budget, and the submit-time coverage rule still requires a budget for a positive amount

#### Scenario: Item-less line uses an explicitly selected budget

- **GIVEN** a `requires_budget` document line that references no item and whose type sets no
  `default_gl_account`
- **WHEN** the requester selects a budget from the selectable-budgets read and saves
- **THEN** the line stores that `budget_id` and no item-GL derivation is applied

#### Scenario: Resolution is company-scoped

- **WHEN** a line's item, fiscal year, and budget are resolved while company A is active
- **THEN** only company A's item enablement (and its per-company GL), fiscal year, and budget
  are considered, and no other company's budget can be resolved onto the line
