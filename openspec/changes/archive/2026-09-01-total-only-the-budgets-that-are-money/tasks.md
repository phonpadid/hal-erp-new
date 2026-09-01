## 1. One declaration of the counted set

- [x] 1.1 Add `COUNTED_BUDGET_STATUSES = ['ACTIVE', 'CLOSED'] as const` to `shared/src/index.ts`
      beside `BUDGET_STATUSES`, moving across the reasoning comment now on the backend constant
      (why `ACTIVE`, why `CLOSED`, why `DRAFT` and `REJECTED` are out, and why it is written as an
      allow-list because `INACTIVE` is reachable and appears in no declared list). Export a
      `CountedBudgetStatus` type alongside it.
- [x] 1.2 Add an `isCountedBudget(status: string): boolean` helper in the same file, so neither
      consumer builds its own `Set` from the tuple.
- [x] 1.3 Rebuild `@erp/shared` (`pnpm --filter @erp/shared build`) — both consumers resolve
      `dist`, not `src`, so the new exports are invisible until it is rebuilt.
- [x] 1.4 In `back/src/modules/reporting/budget-quarter.service.ts`, import
      `COUNTED_BUDGET_STATUSES` from `@erp/shared` and re-export it so its existing callers and
      spec are undisturbed; delete the local declaration and the comment that moved.
- [x] 1.5 Run `back` unit tests and confirm `quarter-report-counts-only-money.spec.ts` passes with
      no edit to the spec file. Behaviour here is unchanged; a green suite is the proof.

## 2. The tree counts only money

- [x] 2.1 In `front-end/src/stores/budgets.ts`, add a `counted: boolean` field to the tree row's
      data type (`BudgetTreeNode`), documented as "does this row's amount belong in an ancestor's
      total?".
- [x] 2.2 Set `counted` from `isCountedBudget(b.status)` when building a budget row in
      `budgetTree`, and `true` on every node row — a node is a container whose figures already
      exclude what was uncounted beneath it.
- [x] 2.3 In the rollup loop, skip rows with `counted === false` when summing `amountTotal` and
      `available`. Leave `budgetCount` summing every budget: it states the reach of a shared-budget
      mark, which covers a `DRAFT` once it is in force.
- [x] 2.4 Confirm the collapse branch (`!kids.length && own.length === 1`) needs no special case —
      it spreads the budget row, so it carries the budget's `counted` and its parent skips it like
      any other. Add a comment saying so, since this is the case from the bug report.

## 3. An uncounted line stays visible and says why

- [x] 3.1 Carry the budget's `status` onto the collapsed node row's data. NO CODE CHANGE NEEDED —
      the task assumed `status` was dropped there; the branch spreads `...only.data`, so it already
      arrives. Pinned by a test instead (4.5) so a future edit to that branch cannot lose it.
- [x] 3.2 In `front-end/src/views/budgets/BudgetListView.vue`, render an uncounted mark in the tree
      presentation on any row with `counted === false` — a `Tag` naming the status, on PrimeUI
      theme tokens so it reads in light and dark, following the pattern of the account-less mark.
- [x] 3.3 Add the label and tooltip to `front-end/src/i18n/locales/{en,la,zh}/budgets.ts` at
      parity — the tooltip saying the amount is not counted into the totals above it and why.

## 4. Tests

- [x] 4.1 Store spec: a category whose only budget is `REJECTED` totals zero, and so does every
      node above it — the case from the bug report, at the collapsed one-budget node.
- [x] 4.2 Store spec: a category holding one `ACTIVE` and one `DRAFT` totals only the `ACTIVE`
      amount; a `CLOSED` budget is still counted; a status in no declared list contributes nothing.
- [x] 4.3 Store spec: uncounted budgets are still present as rows, and `budgetCount` still counts
      every budget beneath the node.
- [x] 4.4 Store spec: totals stay strings summed with `sumAmounts`, never a JS number.
- [x] 4.5 View spec in `front-end/src/views/budgets/`: the tree marks an uncounted row with its
      status, and leaves counted rows unmarked.
- [x] 4.6 No concurrency test: this change writes no `budget_txn` and no `quota_usage` row, opens no
      transaction and takes no lock. Confirm the diff touches no write path.

## 5. Verify against the running app

- [x] 5.1 Run the dev stack and open the budgets tree for the fiscal year holding the withdrawn
      `BUDGET_PLAN-HAL-2026-0002`: node `1.102`, category `1.100` and the department root all read
      zero, and the `1.102` row carries its `REJECTED` mark.
- [x] 5.2 Confirm the flat and control-point presentations are unchanged, and that the quarterly
      budget report's figures are identical before and after.
