## Context

`budgetTree` in `front-end/src/stores/budgets.ts` builds the tree presentation entirely on the
client: it takes `state.list` (the budget list read, loaded unpaginated for this mode) and
`state.nodes` (the plan structure), buckets budgets by `node.id`, and walks the node tree summing
`amountTotal` and `available` upward with `sumAmounts` — a Decimal sum, so the money rule is already
respected. What it has never done is look at `budget.status`, which the list read already returns on
every row (`BudgetSummary.status`).

The consequence is on screen today: `BUDGET_PLAN-HAL-2026-0002` was withdrawn, the plan service's
reject hook correctly flipped budget `1.102` from `DRAFT` to `REJECTED`, and the tree still rolls its
30,000,000 up through `1.100` into the department root. Node `1.102` holds exactly one budget and no
children, so the tree takes its "collapse" branch and renders one row standing for both node and
budget — which is why the figure appears with no Σ marking and no status chip anywhere near it.

The rule itself is settled. `budget-period-reporting` requires every figure it reports to be computed
over `ACTIVE` and `CLOSED` budgets only, and `back/src/modules/reporting/budget-quarter.service.ts`
holds it as `COUNTED_BUDGET_STATUSES` with the reasoning written out. This change extends that rule
to the tree and gives it one home.

## Goals / Non-Goals

**Goals:**

- A node's rolled-up total and available balance count only budgets that are or were money.
- An uncounted budget stays visible and is legible as uncounted, including in the collapsed
  one-budget-per-node case.
- One declaration of the counted set, read by both the backend report and the web tree.

**Non-Goals:**

- No change to `budget.amount_total`, to `budget_txn`, or to any derived-balance formula. This
  change alters what a screen totals, never what the system stores or what it will let a document
  spend.
- No change to the budget list read's payload, filters, or pagination. `status` is already returned.
- No change to the flat or control-point-grouped presentations. Flat is a list, not a rollup, and it
  already shows a status chip per row; the control-point figures come from the server's own
  computation over its governed set.
- Not a filter. Uncounted budgets are not removed from the tree and the status filter is unchanged —
  a user who wants only `ACTIVE` rows already has one.

## Decisions

**The counted set lives in `@erp/shared`, beside `BUDGET_STATUSES`.** The backend already declares
it; the front-end would otherwise declare a second copy, and the failure mode of two copies is a
report and the tree above it stating different money — exactly the class of defect this change
exists to end. `back/src/modules/reporting/budget-quarter.service.ts` imports it and keeps its
`export` so its own callers and spec are undisturbed; the long comment explaining *why* `ACTIVE` and
`CLOSED` and no others moves to the shared declaration, where both readers can find it.

*Alternative considered:* leave the backend constant where it is and duplicate the two strings in the
store. Rejected — two strings are exactly cheap enough to drift silently.

**Expressed as an allow-list, never a deny-list.** Carried over from the backend rule and restated in
the spec because it is load-bearing rather than stylistic: `UpdateBudgetDto.status` validates against
`BUDGET_STATUSES`, but `INACTIVE` is reachable through the budget edit form and appears in no
declared list. A deny-list of `['DRAFT', 'REJECTED']` would admit it into the tree's totals on the
day someone used it.

**Each tree row carries a `counted` flag; the parent's sum skips rows where it is false.** A budget
row's flag comes from its own status. A node row is always `counted: true` — it is a container, and
its figures already exclude whatever was uncounted beneath it. This keeps one rule in one place in
the walk and handles the collapse branch for free: that row is a budget row wearing a node's key, so
it carries the budget's flag and its parent skips it like any other.

*Alternative considered:* filter `state.list` before bucketing, so uncounted budgets never enter the
tree. Rejected — it satisfies the totals and violates the requirement that an uncounted line stay
visible. A department head whose plan was refused would find the row simply gone.

**`budgetCount` keeps counting every budget.** It answers "how many budgets would a mark on this node
cover?", and a shared-budget mark reaches every budget at or beneath the node, including a `DRAFT`
that is approved tomorrow. Narrowing it to counted budgets would understate the reach of a decision
at the moment it is made, which is the opposite of what that figure is for.

**The uncounted mark reuses the pattern of the account-less mark** already required by
`The Budget List Shows Which Budgets Cannot Be Charged` — a PrimeUI-token `Tag` plus an i18n label,
at en/la/zh parity. It states the status (`DRAFT`, `REJECTED`) rather than a generic "not counted",
because the two mean different things to the reader: one is waiting, one was refused.

**Sequence and transaction boundary: none.** This change writes nothing. It touches no `budget_txn`
and no `quota_usage` row, opens no `em.transactional(...)`, and takes no `PESSIMISTIC_WRITE` lock —
there is no concurrent write to serialise, and so no concurrency test to add. The only backend edit
is an import swap in a read-only reporting service.

## Risks / Trade-offs

- **A department root that read 30,000,000 will read 0 after this ships, and that will look like a
  regression to whoever sees it first.** → It is the correct figure: the plan that proposed the money
  was withdrawn. The uncounted row stays on screen carrying its `REJECTED` status, so the tree
  explains where the number went instead of merely losing it.
- **The tree's totals and the flat list's amounts now answer different questions**, and someone
  comparing the two modes could read that as an inconsistency. → The flat list shows per-budget
  amounts with a status chip on every row, never a rollup, so no figure disagrees with another; the
  tree is the only mode that sums.
- **Moving the constant to `@erp/shared` means the backend report now depends on the shared package
  building.** → It already imports `BUDGET_STATUSES` from `@erp/shared` in
  `back/src/modules/budget/dto/budget.dto.ts`; no new dependency edge is created.
- **`@erp/shared` resolves through `dist`, not `src`** (its `exports` map points at
  `./dist/index.js` / `./dist/index.d.ts`, and `dist` is untracked build output). → The shared
  package must be rebuilt after the constant is added, or both consumers resolve a stale
  `index.d.ts` and the new export appears missing. The tasks make that an explicit step.

## Migration Plan

No data migration and no schema change — nothing persisted is affected, so there is nothing to
backfill and nothing to reverse. Rollback is reverting the commit; the tree returns to its previous
totals with no cleanup.

## Open Questions

None. The counted set, its allow-list form, and the reasoning behind each status were settled by
`budget-period-reporting`; this change applies them rather than reopening them.
