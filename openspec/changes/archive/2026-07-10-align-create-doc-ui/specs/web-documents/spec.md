## ADDED Requirements

### Requirement: Type-Driven Item and Budget Affordances in the Create Wizard

The Create Document wizard SHALL drive the line editor's budget and item affordances from the
selected document type's flags, mirroring the server (client validation is UX-only; the server
stays authoritative).

Budget affordances — the item-less fallback budget picker and the read-only resolved-budget
display — SHALL be shown only when the selected type has `requires_budget`. For a type without
`requires_budget`, no budget control SHALL appear on any line.

When the selected type has `requires_item`, the line item picker SHALL carry a visible required
indicator and expose `aria-required`, and the wizard SHALL block save and submit while any line
has no item, surfacing the reason inline on the offending line. When the type does not have
`requires_item`, the item remains optional as before.

On a `requires_budget` type, the wizard SHALL flag — inline, before submit — a line that has a
positive amount, no item, and no selected budget (the client mirror of complete budget
coverage). Item-backed lines are not flagged client-side: the server derives and resolves their
budget, or rejects with a specific message that is surfaced verbatim.

#### Scenario: Budget control is hidden for a non-budget type

- **GIVEN** a selected document type without `requires_budget`
- **WHEN** the requester edits a line (with or without an item)
- **THEN** no budget picker and no resolved-budget display appear on the line

#### Scenario: Budget control appears for a budget-controlled type

- **GIVEN** a selected document type with `requires_budget`
- **WHEN** the requester adds a line with no item
- **THEN** the fallback budget picker is shown for that line; and selecting an item hides the
  picker and shows the resolved budget read-only

#### Scenario: Item-required type marks the item required and blocks an item-less line

- **GIVEN** a selected document type with `requires_item`
- **WHEN** the requester tries to save or submit with a line that has no item
- **THEN** the item field shows a required indicator, the save/submit is blocked, and an inline
  message identifies the line lacking an item

#### Scenario: Positive item-less line without a budget is flagged before submit

- **GIVEN** a selected document type with `requires_budget`
- **WHEN** a line has a positive amount, no item, and no selected budget
- **THEN** the wizard flags that line inline and does not submit until a budget is chosen

#### Scenario: Item line trusts server budget resolution

- **GIVEN** a `requires_budget` type and a line that carries an item
- **WHEN** the requester submits
- **THEN** the client does not require a manually chosen budget for that line, and any server
  rejection (for example no active budget for the item's GL) is surfaced verbatim

## MODIFIED Requirements

### Requirement: Per-Line Budget Selection in the Create Wizard

The Create Document wizard SHALL let a `DOC_CREATE` user assign a budget to an **item-less**
line of a budget-controlled document (`document_type.requires_budget`), populating the per-line
budget selector from the selectable-budgets read (which returns `id`, `budgetName`, and
`glAccount` and is itself authorized by `DOC_CREATE`). The selector SHALL be shown only for
`requires_budget` types and only for lines that carry no item; for an item-backed line the
budget is resolved server-side from the item's GL and shown read-only, not selected. The
affordance SHALL be shown to `DOC_CREATE` creators and SHALL NOT be gated on `BUDGET_VIEW`; a
creator without `BUDGET_VIEW` SHALL still be able to see and choose a budget for an item-less
line. The selector SHALL send the chosen `budgetId` on save, with the server remaining
authoritative for reservation at submit. The Budgets pages (balances, breakdown, ledger) remain
gated by `BUDGET_VIEW` and are unaffected.

#### Scenario: Creator without BUDGET_VIEW sees the budget selector

- **GIVEN** a signed-in user holding `DOC_CREATE` but not `BUDGET_VIEW`
- **WHEN** the user opens the Create wizard for a `requires_budget` document type and adds an
  item-less line
- **THEN** that line offers a budget selector populated from the selectable-budgets read

#### Scenario: Selected budget is sent on save

- **WHEN** the creator chooses a budget for an item-less line and saves the draft
- **THEN** that line's `budgetId` is sent to the server

#### Scenario: Budget balances are not exposed by the selector

- **WHEN** the creator opens the per-line budget selector
- **THEN** each option shows only its label (e.g. GL account / name) and no budget amount or
  available balance
