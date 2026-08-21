## MODIFIED Requirements

### Requirement: Per-Line Budget Selection in the Create Wizard

The Create Document wizard SHALL let a `DOC_CREATE` user assign a budget to **every** line of a
budget-controlled document (`document_type.requires_budget`), item-backed or not, populating the
per-line budget selector from the selectable-budgets read (which returns `id`, `code`, `budgetName`
and `parentId` and is itself authorized by `DOC_CREATE`).

The selector was previously offered only on an item-less line, because an item-backed line had its
budget derived from the item's GL. That derivation is gone: one account is charged by several
budgets, so the account cannot choose between them and only the requester can. The selector SHALL be
shown for every line of a `requires_budget` type, and the line's derived GL account SHALL be shown
**beside** it as read-only context rather than in place of it — the two are different facts and the
screen SHALL NOT imply that either determines the other.

The selector SHALL be filtered to the document's department and SHALL be searchable by code and by
name, because a requester in the largest department chooses among more than a hundred budgets and
speaks in codes. It SHALL show each option's `code` and `budgetName` together, since the code is
what the requester knows the budget by.

The affordance SHALL be shown to `DOC_CREATE` creators and SHALL NOT be gated on `BUDGET_VIEW`; a
creator without `BUDGET_VIEW` SHALL still be able to see and choose a budget. The selector SHALL
send the chosen `budgetId` on save, with the server remaining authoritative for reservation at
submit. The Budgets pages (balances, breakdown, ledger) remain gated by `BUDGET_VIEW` and are
unaffected.

#### Scenario: Creator without BUDGET_VIEW sees the budget selector

- **GIVEN** a signed-in user holding `DOC_CREATE` but not `BUDGET_VIEW`
- **WHEN** the user opens the Create wizard for a `requires_budget` document type and adds a line
- **THEN** that line offers a budget selector populated from the selectable-budgets read

#### Scenario: An item-backed line offers the selector too

- **GIVEN** a `requires_budget` document and a line referencing an item
- **WHEN** the wizard renders that line
- **THEN** a budget selector is offered, and the item's derived GL account is shown beside it as
  read-only

#### Scenario: Choosing a budget does not change the shown GL

- **GIVEN** an item-backed line showing a derived GL account
- **WHEN** the requester chooses a budget
- **THEN** the shown GL account is unchanged

#### Scenario: The selector is filtered to the document's department

- **WHEN** the creator opens the per-line budget selector
- **THEN** only budgets of the document's department are offered

#### Scenario: The selector can be searched by code

- **GIVEN** a department with more than a hundred budgets
- **WHEN** the creator types a budget code into the selector
- **THEN** the list narrows to the matching budgets

#### Scenario: Selected budget is sent on save

- **WHEN** the creator chooses a budget for a line and saves the draft
- **THEN** that line's `budgetId` is sent to the server

#### Scenario: A line left without a budget is surfaced before submit

- **GIVEN** a `requires_budget` document with a positive-amount line naming no budget
- **WHEN** the creator tries to submit
- **THEN** the wizard identifies that line as missing its budget rather than letting the submit be
  refused with no indication of which line is at fault

#### Scenario: Budget balances are not exposed by the selector

- **WHEN** the creator opens the per-line budget selector
- **THEN** each option shows only its code and name, and no budget amount or available balance
