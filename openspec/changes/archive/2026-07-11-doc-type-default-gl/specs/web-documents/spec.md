## MODIFIED Requirements

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

For an item-less line on a `requires_budget` type, the wizard SHALL resolve the budget in the
same precedence as the server: an explicitly chosen budget wins; otherwise, when the type sets a
`default_gl_account` that matches a loaded selectable budget, the wizard SHALL show that resolved
budget read-only (like an item-backed line) and SHALL NOT require a manual pick; otherwise the
fallback picker SHALL be shown. The wizard SHALL flag — inline, before submit — a positive
item-less line only when no budget resolves for it (neither an explicit pick nor a type default).
Item-backed lines are not flagged client-side: the server derives and resolves their budget, or
rejects with a specific message that is surfaced verbatim.

#### Scenario: Budget control is hidden for a non-budget type

- **GIVEN** a selected document type without `requires_budget`
- **WHEN** the requester edits a line (with or without an item)
- **THEN** no budget picker and no resolved-budget display appear on the line

#### Scenario: Budget control appears for a budget-controlled type

- **GIVEN** a selected document type with `requires_budget` and no `default_gl_account`
- **WHEN** the requester adds a line with no item
- **THEN** the fallback budget picker is shown for that line; and selecting an item hides the
  picker and shows the resolved budget read-only

#### Scenario: Type default GL auto-resolves an item-less line's budget

- **GIVEN** a `requires_budget` type whose `default_gl_account` matches a loaded selectable
  budget
- **WHEN** the requester adds a line with no item
- **THEN** the resolved budget is shown read-only, the manual picker is not shown, and the line
  is not flagged for a missing budget

#### Scenario: Item-required type marks the item required and blocks an item-less line

- **GIVEN** a selected document type with `requires_item`
- **WHEN** the requester tries to save or submit with a line that has no item
- **THEN** the item field shows a required indicator, the save/submit is blocked, and an inline
  message identifies the line lacking an item

#### Scenario: Positive item-less line without a resolvable budget is flagged before submit

- **GIVEN** a `requires_budget` type with no `default_gl_account` (or whose default does not
  match a loaded budget)
- **WHEN** a line has a positive amount, no item, and no selected budget
- **THEN** the wizard flags that line inline and does not submit until a budget is chosen

#### Scenario: Item line trusts server budget resolution

- **GIVEN** a `requires_budget` type and a line that carries an item
- **WHEN** the requester submits
- **THEN** the client does not require a manually chosen budget for that line, and any server
  rejection (for example no active budget for the item's GL) is surfaced verbatim
