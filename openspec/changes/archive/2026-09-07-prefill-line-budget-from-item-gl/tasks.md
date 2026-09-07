## 1. Backend — expose the budget's account on the selectable read

No entity or migration work: `budget.gl_account` and `item_company.default_gl_account` already exist
and are populated. This group only widens a read projection.

- [x] 1.1 Add `glAccount?: string` to the `SelectableBudget` interface in
  `back/src/modules/budget/budget.service.ts`, documenting that it is absent (not empty) when the
  budget spans several accounts.
- [x] 1.2 In `BudgetService.listSelectable`, add `'glAccount'` to the `fields` list and map
  `glAccount: b.glAccount ?? undefined` into the returned row, keeping the existing "no amount leaks"
  comment accurate about what the response now carries.
- [x] 1.3 In `back/src/modules/budget/budget-selectable.spec.ts`, assert the read returns the
  `gl_account` of a budget that records one, and omits the key entirely for a budget whose
  `gl_account` is null.
- [x] 1.4 In the same spec, re-assert the no-figures guarantee against the widened shape: no
  `amountTotal`, balance, breakdown or ledger key appears on any returned row.
- [x] 1.5 Confirm the `DOC_CREATE` permission-gate tests already in that file still pass unchanged —
  the gate does not move.

## 2. Frontend — prefill instead of clearing

- [x] 2.1 Add `glAccount?: string` to the `SelectableBudget` interface in
  `front-end/src/api/budgets.ts`.
- [x] 2.2 In `front-end/src/views/documents/LineItemsEditor.vue`, widen the `budgets` prop type to
  carry `glAccount?: string`.
- [x] 2.3 In the same file, add a `budgetForGl(gl?: string)` helper that returns the single
  `props.budgets` entry whose `glAccount` equals `gl`, and `undefined` when zero or more than one
  match.
- [x] 2.4 Rewrite `onItemChange` so it never assigns `undefined` to `l.budgetId`: when the line has
  no budget yet, set it from `budgetForGl(glForItem(l.itemId))`; otherwise leave the requester's
  choice alone. Replace the stale comment about the server resolving the budget.
- [x] 2.5 Verify the budget chip beside the GL chip now renders the prefilled label rather than
  `$t('documents.create.none')`, with no template change needed (`chosenBudgetLabel` already reads
  `line.budgetId`).
- [x] 2.6 Check `front-end/src/views/documents/CreateDocumentView.vue` passes the widened budget rows
  straight through to the editor — the `budgets` ref type annotation needs `glAccount?: string` too.

## 3. Frontend tests

- [x] 3.1 In `front-end/src/views/documents/create-document-ux.spec.ts`, cover: picking an item whose
  per-company GL matches exactly one selectable budget prefills that line's `budgetId`.
- [x] 3.2 Cover: two selectable budgets sharing the item's GL leave `budgetId` unset and the line
  still reported as missing a budget.
- [x] 3.3 Cover: no selectable budget carries the item's GL — `budgetId` stays unset.
- [x] 3.4 Cover the regression directly: a line with a hand-picked `budgetId` keeps it after the item
  is selected and after the item is changed to a different one.
- [x] 3.5 Cover: a prefilled `budgetId` is replaced when the requester picks a different budget, and
  that is the value sent on save.
- [x] 3.6 Cover: prefilling a budget does not change the line's displayed GL account.

## 4. Specs and verification

- [x] 4.1 Run `openspec validate prefill-line-budget-from-item-gl --strict` and fix anything it
  reports.
- [x] 4.2 Run the backend suite (`pnpm --filter back test`) and the frontend suite
  (`pnpm --filter front-end test`); both green.
- [x] 4.3 Manually verify against the local database on `:5433`: sign in as an IT-department user,
  open the Create wizard for a `requires_budget` type, pick `AWS ຄ່າເຊີເວີ SWS` (GL `5001`), and
  confirm the line prefills `ງົບໃຊ້ໃນການພັດທະນາ IT` and the step advances without a manual pick.
- [x] 4.4 Run `/opsx:archive prefill-line-budget-from-item-gl` once the above is confirmed, folding
  the deltas into `openspec/specs/budget-control/spec.md` and
  `openspec/specs/web-documents/spec.md` (which removes the contradicting stale text there).
