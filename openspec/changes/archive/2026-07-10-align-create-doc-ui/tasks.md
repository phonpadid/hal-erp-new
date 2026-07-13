## 1. Pass type flags into the line editor

- [x] 1.1 In `CreateDocumentView.vue`, derive `requiresBudget` / `requiresItem` from
  `selectedType()` and pass them to `<LineItemsEditor>` (replace the permission-only
  `:can-budget` gating for budget affordances)
- [x] 1.2 Add `requiresBudget` / `requiresItem` props to `LineItemsEditor.vue`
  (`api/documents` creatable-type type already carries `requiresItem` from the backend read;
  add it to the frontend type if missing)

## 2. Gate budget affordances on requires_budget

- [x] 2.1 Show the fallback budget picker only when `requiresBudget && !line.itemId`
- [x] 2.2 Show the resolved-budget read-only chip only when `requiresBudget && line.itemId`
- [x] 2.3 Confirm a non-budget type renders no budget control on any line

## 3. Enforce requires_item in the wizard

- [x] 3.1 When `requiresItem`, mark the line item picker required (visible indicator +
  `aria-required`)
- [x] 3.2 Add a line-level validity check: on `requiresItem`, a line with no `itemId` is
  invalid; surface an inline message on the offending line and block advance/save/submit
- [x] 3.3 Keep the item optional when `requiresItem` is false (unchanged behavior)

## 4. Client mirror of complete budget coverage

- [x] 4.1 On `requiresBudget`, flag a line with a positive amount, no item, and no `budgetId`
  as invalid, with an inline message; do not flag item-backed lines (server resolves them)
- [x] 4.2 Ensure the server rejection on submit is still surfaced verbatim (existing
  `fb.error` path) for cases the client cannot pre-check (e.g. item GL with no active budget)

## 5. i18n + validation wiring

- [x] 5.1 Add en/la strings for the new inline messages (item required, budget required on a
  positive item-less line)
- [x] 5.2 Wire the new checks into the existing lines-step validation path (the same channel
  as the numeric `lineInvalid` check), so step-failure + focus + inline error behave as today

## 6. Verification

- [x] 6.1 Run `openspec validate --changes align-create-doc-ui --strict`
- [x] 6.2 Frontend `vue-tsc` clean for the changed files
- [x] 6.3 Component test (or manual, if the frontend test runner is unavailable): non-budget
  type shows no budget control; `requires_item` type blocks an item-less line; a positive
  item-less budget-less line is flagged on a `requires_budget` type
