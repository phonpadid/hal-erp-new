## Why

A requester who has already told the item master which budget an item spends against must
nonetheless pick that budget again, by hand, on every line of every document — and worse, picking
the item **erases** a budget they had already chosen, because `LineItemsEditor.onItemChange` still
clears `budgetId` on the assumption that the server will resolve one. It no longer does. The line
then shows `budget —` beside its GL chip and refuses to advance, which reads to the user as
"the budget data never arrived".

The customer's own data makes the redundancy plain: in company HAL, `item_company.default_gl_account`
is `5001` for two items and `5000` for two more, and each of those accounts is carried by exactly one
`ACTIVE` budget in the open fiscal year. Every one of those picks has exactly one right answer, and
the wizard asks anyway.

## What Changes

- **Fix**: `onItemChange` no longer discards the line's `budgetId`. Choosing or changing an item
  SHALL NOT silently unset a budget the requester named. This is the defect behind the empty
  `ຮັບປະມານ —` chip.
- **New**: when a requester picks an item, the wizard prefills the line's budget from the item's
  per-company GL — matching `item_company.default_gl_account` against `budget.gl_account` across the
  already-loaded selectable list. Exactly one match prefills it; zero or several leave the picker
  empty for the requester to answer, as today.
- The prefilled value stays **editable**: it is a default, not a derivation. The picker remains
  visible on every line of a `requires_budget` type.
- **API**: `GET /budgets/selectable` gains `glAccount` per row (absent when the budget records none).
  It is an account code, not a figure, so the read stays free of money and its `DOC_CREATE` gate is
  unchanged.
- **Not changing**: the server still refuses to derive a budget from a line's `gl_account`
  (`document-engine` — *Item-Driven GL and Budget Resolution on Lines*). The client sends an explicit
  `budgetId` exactly as it does now; submit-time coverage, reservation and validation are untouched.
- **Cleanup**: `web-documents` still carries the superseded requirement that an item-backed line's
  budget is derived and its picker hidden (lines 71–76, 141–162), contradicting the later
  *Per-Line Budget Selection in the Create Wizard*. This change removes the stale text so one
  behaviour is described once.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities

- `budget-control`: the selectable-budgets read returns each budget's `gl_account` alongside its
  existing selection fields, so a client can tell which budgets carry a given account.
- `web-documents`: the Create wizard prefills a line's budget from the item's GL when exactly one
  selectable budget carries that account, never clears a chosen budget when the item changes, and no
  longer describes the removed server-side derivation.

## Impact

**Backend**
- `back/src/modules/budget/budget.service.ts` — `SelectableBudget` gains `glAccount`; `listSelectable`
  adds `glAccount` to `fields` and to the mapped row.
- `back/src/modules/budget/budget-selectable.spec.ts` — coverage for the new field and for its
  absence on a multi-account budget.

**Frontend**
- `front-end/src/api/budgets.ts` — `SelectableBudget` gains `glAccount?: string`.
- `front-end/src/views/documents/LineItemsEditor.vue` — `onItemChange` prefills instead of clearing;
  new `budgetForGl` lookup over `props.budgets`.
- `front-end/src/views/documents/create-document-ux.spec.ts` — prefill on single match, no prefill on
  ambiguity, no clobber of an existing pick.

**Invariants**
- Invariant 1 (company isolation): unaffected — the read is already company-scoped and department-
  filtered; no new row becomes reachable.
- Invariant 3/4 (derived balances, reserve→actual→release): unaffected — no change to `budget_txn`.
- Invariant 7 (configuration over code): the prefill reads configuration (`item_company`,
  `budget.gl_account`); no per-document-type branch is introduced.
- The client guard stays UX-only; the server remains authoritative and still validates the submitted
  `budgetId` for company and `ACTIVE` status.

**Data**
- No migration. `item_company.default_gl_account` and `budget.gl_account` already exist and are
  already populated in the customer's database.
