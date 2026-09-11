## 1. Measure the exposure before changing anything

- [x] 1.1 Run the recursive coverage query against the target database and record which control
      points change ceiling, by how much, and whether any goes negative. Same walk
      `budgetsGovernedBy` performs — node ancestors joined to department ancestors — filtered to
      `b.status not in ('ACTIVE','CLOSED')` over `cp.is_active`. Keep the output: it is what
      finance is told, and it is the before-picture the tests are written against.

## 2. The ceiling counts only money

- [x] 2.1 In `budget-balance.service.ts`, import `isCountedBudget` from `@erp/shared`. Do not
      restate the status list in the backend — a second copy is how the client and server drifted
      apart in the first place.
- [x] 2.2 `balanceAt`: sum `amountTotal` over the loaded budgets that pass `isCountedBudget`; keep
      summing `budget_txn` over ALL of them. The filter goes after the entity load, never into the
      `find` — a `status` predicate in the query would drop the ledger rows too, which is the
      behaviour the design rejects.
- [x] 2.3 `balanceAtMany`: same rule. Set `amountById` only for counted budgets (or skip
      non-counted ids when folding the rollup); leave `usedById` populated for every id.
- [x] 2.4 `breakdownAt`: no change needed. It already delegates `amountTotal` and `available` to
      `balanceAt`, so it inherited the rule; a test pins that the three agree rather than trusting
      the delegation to survive an edit.
- [x] 2.5 Comment each of the three with WHY the two halves are asymmetric, not just that they are.
      The next reader's instinct will be to make them match.

## 3. Tests

- [x] 3.1 Unit: a control point governing an `ACTIVE` 0 and a `REJECTED` 23,056,000 reports a
      ceiling of 0. This is the customer case, by its own numbers.
- [x] 3.2 Unit: a `DRAFT` budget contributes nothing; a `CLOSED` one contributes its amount.
- [x] 3.3 Unit: an `INACTIVE` budget of 200,000 holding an outstanding RESERVE of 50,000 leaves the
      ceiling alone and still counts its 50,000 in `used`. The asymmetry, pinned.
- [x] 3.4 Unit: `balanceAt`, `balanceAtMany` and `breakdownAt` agree on the same mixed-status group.
      The spec already requires the first two never to disagree; the third joins them here.
- [x] 3.5 Unit: coverage is untouched — `budgetsGovernedBy` still returns the `REJECTED` budget, so
      the detail screen keeps showing what is sitting under the point.
- [x] 3.6 e2e: submit a document charging a zero `ACTIVE` budget whose node also holds a `REJECTED`
      one, under `BLOCK at 100`, and assert `BUDGET_EXCEEDED`. Without the fix this submission is
      accepted, which is the whole report.
- [x] 3.7 `budget-control-point-concurrency.spec.ts` passes unchanged, 12/12 — the lock sequence is
      untouched and this proves it. Its e2e counterpart ("two submissions racing for the last of a
      budget") sits in the pre-existing failure set described in 4.2 and was not exercised.

## 4. Close the loop

- [x] 4.1 `pnpm --filter back test` green.
- [x] 4.2 `dev-stack.sh e2e` — `20-budget-plan.e2e.spec.ts` passes 6/6. The FULL suite is red both
      with and without this change: 88 identically-failing tests, from a pre-existing fixture drift
      (`E2E.CLAIM` was provisioned at 110,000,000 against `SANDBOX.budgetAmount` of 100,000,000, and
      `amount_total` is never overwritten, so `00-sandbox` fails and the rest cascade). Captured both
      failure sets and diffed them: identical modulo the line-number shift from this change's added
      imports. Not this change's to fix.
- [x] 4.3 Re-run 1.1 and confirm the only ceilings that moved are the ones it predicted.
- [x] 4.4 No file under `front-end/src` was touched BY THIS CHANGE. The working tree does carry
      front-end edits, all of them from `set-a-budget-the-plan-never-funded`, which is archived but
      not yet committed — worth knowing before reading a diff of the tree as this change's diff.
