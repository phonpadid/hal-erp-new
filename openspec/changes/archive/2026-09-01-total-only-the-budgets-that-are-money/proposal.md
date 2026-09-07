## Why

The budget list's tree presentation totals every budget it has loaded, whatever its status. A
`REJECTED` budget left behind by a withdrawn budget plan — and every `DRAFT` still waiting for the
approval that would put it in force — is added into its ancestors' rolled-up figures and rendered as
an ordinary money line. On the running app a department root reads 30,000,000 when the company has
nothing approved: the one plan that proposed that money was cancelled, the budget was correctly
marked `REJECTED`, and the tree kept counting it anyway.

The rule that fixes this is already decided and already written down. `budget-period-reporting`
states that every figure it reports is computed over budgets whose status is `ACTIVE` or `CLOSED`
and over no others, and the backend holds it as `COUNTED_BUDGET_STATUSES`. The tree simply never got
it. The same reasoning applies with more force here, because this is the screen a department head
uses to check that a subtree sums to what they approved.

## What Changes

- The tree presentation's rolled-up totals SHALL be computed over budgets that are or were money —
  `ACTIVE` or `CLOSED` — and over no others. A `DRAFT` or `REJECTED` budget contributes nothing to
  any ancestor's total, its own amount included.
- A budget that is not counted SHALL still be shown, and shown as not counted. It is not dropped: a
  `DRAFT` is a plan being written and a `REJECTED` is the record of what was refused, and a tree
  that hid them would answer "what happened to the budget I proposed?" with silence. Its own row
  states its status and that its amount is outside the totals.
- A node holding exactly one budget and no children — which the tree renders AS that budget, the
  case in the report above — SHALL follow the same rule: when that single budget is not money, the
  row is presented as an uncounted line and the node contributes zero upward.
- The counted-status set SHALL become one declaration in `@erp/shared`, read by both the backend
  report and the web tree, so the two cannot drift. It stays expressed as the statuses that ARE
  counted, never as the ones excluded — `INACTIVE` is reachable through the budget edit form and
  appears in no declared list, so a deny-list would admit it.
- No change to any read's payload, to `budget.amount_total`, or to any ledger. This is what the
  screen totals, not what the system stores.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-budgets`: `The Budget List Reads as a Tree` gains the rule that a category's rolled-up figure
  counts only budgets that are or were money, and that an uncounted budget is shown as uncounted
  rather than dropped or silently summed.

## Impact

- `shared/src/index.ts` — `COUNTED_BUDGET_STATUSES` moves here beside `BUDGET_STATUSES`, with the
  reasoning that currently lives on the backend constant.
- `back/src/modules/reporting/budget-quarter.service.ts` — re-exports or imports the shared constant
  instead of declaring its own. Behaviour unchanged; the existing
  `quarter-report-counts-only-money.spec.ts` must stay green untouched.
- `front-end/src/stores/budgets.ts` — `budgetTree` excludes uncounted budgets from `amountTotal`,
  `available` and `budgetCount` sums, and tags uncounted rows.
- `front-end/src/views/budgets/BudgetListView.vue` — renders the uncounted mark in the tree columns,
  using PrimeUI theme tokens.
- `front-end/src/i18n/locales/{en,la,zh}/budgets.ts` — the mark's label and tooltip, at parity.
- Invariants: none at risk. Invariant 3 is untouched — no balance formula changes, and
  `amount_total` is never rewritten. Company isolation is unaffected; the tree already renders only
  the active company's loaded list.
