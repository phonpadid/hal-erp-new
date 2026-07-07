## ADDED Requirements

### Requirement: Per-Line Budget Selection in the Create Wizard

The Create Document wizard SHALL let a `DOC_CREATE` user assign a budget to each line of a
budget-controlled document (`document_type.requires_budget`), populating the per-line budget
selector from the selectable-budgets read (which returns `id`, `budgetName`, and `glAccount`
and is itself authorized by `DOC_CREATE`). The affordance SHALL be shown to `DOC_CREATE`
creators and SHALL NOT be gated on `BUDGET_VIEW`; a creator without `BUDGET_VIEW` SHALL still
be able to see and choose a budget for a line. The selector SHALL send the chosen `budgetId` on
save, with the server remaining authoritative for reservation at submit. The Budgets pages
(balances, breakdown, ledger) remain gated by `BUDGET_VIEW` and are unaffected.

#### Scenario: Creator without BUDGET_VIEW sees the budget selector

- **GIVEN** a signed-in user holding `DOC_CREATE` but not `BUDGET_VIEW`
- **WHEN** the user opens the Create wizard for a `requires_budget` document type
- **THEN** each line offers a budget selector populated from the selectable-budgets read

#### Scenario: Selected budget is sent on save

- **WHEN** the creator chooses a budget for a line and saves the draft
- **THEN** that line's `budgetId` is sent to the server

#### Scenario: Budget balances are not exposed by the selector

- **WHEN** the creator opens the per-line budget selector
- **THEN** each option shows only its label (e.g. GL account / name) and no budget amount or
  available balance
