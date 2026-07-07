## 1. Backend — selectable-budgets read

- [x] 1.1 Add a `listSelectable()` method to `BudgetService` that returns only
  `{ id, budgetName, glAccount }` for the active company's `ACTIVE` budgets, scoped through
  `fiscalYear.company` and forking its own EntityManager (mirror the existing `list()` scope;
  do NOT populate currency or `amountTotal`).
- [x] 1.2 Add `GET /budgets/selectable` to `BudgetController` gated by
  `@RequirePermissions(DOC_CREATE)`, ordered before the `:id` route so `selectable` is not
  captured as an id param.
- [x] 1.3 Reference the `DOC_CREATE` code from the document module's permissions (or a shared
  catalog) rather than redefining it in the budget module (invariant 6 — authorize on codes).
- [x] 1.4 Confirm the response projection contains no amount/balance/breakdown/ledger fields
  (structural exclusion per design D2).

## 2. Backend — tests

- [x] 2.1 Unit/e2e: a user with `DOC_CREATE` but not `BUDGET_VIEW` gets the active company's
  `ACTIVE` budgets from `GET /budgets/selectable`.
- [x] 2.2 Test: the response for each budget has no `amountTotal`, balance, breakdown, or
  ledger keys (guards against a projection regression re-introducing money).
- [x] 2.3 Test: company scope — only the active company's budgets are returned; another
  company's budget never appears.
- [x] 2.4 Test: budgets whose `status` is not `ACTIVE` are excluded.
- [x] 2.5 Test: a user with neither `DOC_CREATE` nor `BUDGET_VIEW` is rejected (unauthorized).

## 3. Frontend — wizard wiring

- [x] 3.1 Add an API call for the selectable-budgets read (e.g. in `api/budgets.ts` or
  `api/documents.ts`) returning `Array<{ id; budgetName?; glAccount }>`.
- [x] 3.2 In `CreateDocumentView.vue`, change `canBudget` to derive from `DOC_CREATE` (the
  create permission the view already holds) instead of `BUDGET_VIEW`, and fetch the picklist
  from the new read instead of `GET /budgets`.
- [x] 3.3 Keep `LineItemsEditor.vue`'s budget column shape unchanged; verify it renders from
  the picklist options (label by `glAccount`, value by `id`) and shows no amounts.
- [x] 3.4 Update the `budgetNotice` empty-state condition so it only shows when there are no
  selectable budgets for a `requires_budget` type — not when the user merely lacks
  `BUDGET_VIEW`.

## 4. Frontend — tests

- [x] 4.1 Update `create-document-ux.spec.ts`: the per-line budget selector is present for a
  `DOC_CREATE` user without `BUDGET_VIEW` on a budget-controlled type.
- [x] 4.2 Test: a chosen budget's `budgetId` is reflected on the line (id→label wiring) and the
  wizard save maps `budgetId` on each line (`CreateDocumentView` line payload).

## 5. Verify end-to-end

- [x] 5.1 Verified the pieces of the DOC_CREATE-only flow via tests: guard allows DOC_CREATE
  without BUDGET_VIEW, the selectable read returns choosable budgets, the editor binds
  `budgetId`, and the wizard save maps `budgetId` onto each line (submit already reserves from
  budgeted lines). NOTE: not driven against a live running stack in this session.
- [x] 5.2 Confirmed the Budgets reads (`GET /budgets`, `:id`, balance, breakdown, ledger) are
  untouched and still gated by `BUDGET_VIEW`; only an additive `selectable` route was added.
- [x] 5.3 `openspec validate add-budget-picklist` passes; backend budget suite 35/35 green;
  new frontend budget tests pass; changed files typecheck clean (2 pre-existing test failures
  and 1 pre-existing tsc error in `LineItemsEditor.vue` are unrelated to this change).
