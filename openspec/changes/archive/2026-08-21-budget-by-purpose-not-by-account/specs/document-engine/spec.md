## MODIFIED Requirements

### Requirement: Item-Driven GL and Budget Resolution on Lines

A line's `gl_account` and its `budget_id` are two independent facts about it, and the system SHALL
resolve them independently. The account says what kind of expense the line is; the budget says whose
money pays for it. One account is charged by several budgets and one budget posts to several
accounts, so neither can be computed from the other.

When a document line references an `item`, the system SHALL derive the line's
`gl_account` from that item's **per-company GL — the active company's
`item_company.default_gl_account`** — server-authoritatively, ignoring any `gl_account` value
supplied by the client. The group `item` table carries no GL. For a document type where
`requires_budget` is true, the system SHALL reject line save or submit when an item-backed line's
item has **no `item_company.default_gl_account`** for the active company. Deriving the account is
unchanged.

The line's `budget_id` SHALL be the budget the requester named, taken from the selectable-budgets
read and scoped to the document's company (invariant 1). The system SHALL NOT derive a budget from
the line's `gl_account`, and naming a budget SHALL NOT stamp or overwrite the line's `gl_account` —
the previous behaviour, in which choosing a budget replaced the account, is inverted here. A budget
of another company or one whose `status` is not `ACTIVE` SHALL be rejected. Nothing needs to be said
about categories: a category is a `budget_node`, not a budget, so there is no id a line could name
that would charge one.

A line that carries no item SHALL take its `gl_account`, in this precedence: (1) the document type's
`default_gl_account` when set; (2) otherwise the `gl_account` of the named budget, when that budget
records one; (3) otherwise the line carries no GL. This is the only remaining read of
`budget.gl_account`, and a budget spanning several accounts records none.

This requirement changes only how a line's `gl_account` and `budget_id` are chosen. It does
not change budget reservation, conversion, or release (invariants 3–5), which continue to
act on the resolved `budget_id`. The submit-time coverage rule is unchanged and still refuses a
positive-amount line that carries no budget — what changes is that such a line is now one nobody
named, rather than one whose account matched nothing.

#### Scenario: Item derives the GL and the requester names the budget

- **GIVEN** a `requires_budget` document in a department, with an item whose active-company
  `item_company.default_gl_account` is `5210`
- **WHEN** the requester adds a line referencing that item and names budget `1.101`
- **THEN** the line's `gl_account` is set to `5210` and its `budget_id` is `1.101`, and neither
  value was computed from the other

#### Scenario: Two lines on one account charge different budgets

- **GIVEN** two lines whose items both derive `gl_account` `658.0007`
- **WHEN** the requester names budget `7.1 fuel` on one and `7.5 repairs` on the other
- **THEN** both lines are accepted, each carrying the same account and a different budget

#### Scenario: Naming a budget does not change the line's account

- **GIVEN** an item-backed line whose derived `gl_account` is `5210`
- **WHEN** the requester names a budget that records a different `gl_account`
- **THEN** the line's `gl_account` remains `5210`

#### Scenario: Client-supplied GL on an item line is ignored

- **GIVEN** an item-backed line whose item's per-company GL is `5210`
- **WHEN** the client sends a different `gl_account` on save
- **THEN** the server overwrites it with the item's per-company GL

#### Scenario: Item without a per-company GL is rejected on a budget-required type

- **GIVEN** a `requires_budget` document and an item with no `item_company.default_gl_account`
  for the active company
- **WHEN** the requester tries to save or submit a line referencing that item
- **THEN** the operation is rejected with an error identifying the item as having no GL

#### Scenario: An item-backed line with no named budget is refused at submit

- **GIVEN** a `requires_budget` document whose item-backed line has a positive amount and names
  no budget
- **WHEN** the document is submitted
- **THEN** the submit is rejected identifying that line, and the document stays DRAFT with
  nothing reserved

#### Scenario: Item GL is company-scoped

- **GIVEN** an item whose `item_company.default_gl_account` is `5300` in company A and `5210`
  in company B
- **WHEN** an item line referencing it is created while company B is active
- **THEN** the line's `gl_account` is `5210` (company B's value), and company A's `5300` is
  never used

#### Scenario: A budget of another company is refused

- **WHEN** a line names a `budget_id` belonging to a company other than the document's
- **THEN** the line is rejected and no budget is stored on it

#### Scenario: An inactive budget is refused

- **WHEN** a line names a budget whose `status` is not `ACTIVE`
- **THEN** the line is rejected

#### Scenario: A category cannot be charged because it is not a budget

- **WHEN** the budgets a line may name are listed
- **THEN** no category appears among them, because categories are nodes and only budgets are
  chargeable

#### Scenario: Type default GL stamps an item-less line

- **GIVEN** a `requires_budget` type whose `default_gl_account` is `5210`
- **WHEN** the requester adds a line with no item and names a budget
- **THEN** the line's `gl_account` is set to `5210` and its `budget_id` is the named budget

#### Scenario: An item-less line falls back to the budget's recorded account

- **GIVEN** a `requires_budget` type that sets no `default_gl_account`, and a named budget whose
  `gl_account` is `5210`
- **WHEN** the requester saves an item-less line
- **THEN** the line's `gl_account` is stamped `5210` from the budget

#### Scenario: An item-less line on a budget that records no account carries no GL

- **GIVEN** a type with no `default_gl_account` and a named budget whose `gl_account` is null
- **WHEN** the requester saves an item-less line
- **THEN** the save is not rejected and the line carries a budget with no GL

#### Scenario: Resolution is company-scoped

- **WHEN** a line's item, fiscal year, and budget are resolved while company A is active
- **THEN** only company A's item enablement (and its per-company GL), fiscal year, and budgets
  are considered, and no other company's budget can be placed on the line
