## Context

Three methods on `BudgetBalanceService` sum a group's `amount_total`, and all three do it the same
wrong way — over every governed budget, regardless of `budget.status`:

- `balanceAt(governedBudgetIds, capAmount)` — the single-point figure, and the one
  `BudgetLedgerService.reserveIn` evaluates the tolerance ladder against.
- `balanceAtMany(groups)` — the same arithmetic batched for the control point list, which the spec
  already requires never to disagree with `balanceAt`.
- `breakdownAt(governedBudgetIds, capAmount)` — the component breakdown behind the control point
  detail screen, whose `amountTotal` component is that same ceiling.

`BudgetCoverageService.budgetsGovernedBy` supplies the id list to all three. It is a recursive
walk up the node and department trees and carries no status predicate — correctly, because it
answers a different question.

`@erp/shared` already declares the rule these three should have been using:
`COUNTED_BUDGET_STATUSES = ['ACTIVE', 'CLOSED']` with `isCountedBudget`, consumed by the web app for
every total it renders. The backend imports `@erp/shared` already (`canTransitionBudget` is used by
`BudgetService`), so the constant is one import away rather than a value to restate.

## Goals / Non-Goals

**Goals:**

- A budget that is not an appropriation contributes nothing to any ceiling.
- The three derivations keep agreeing with each other, by construction rather than by care.
- The rule the client already applies to totals and the rule the server applies to refusals become
  the same rule, sourced from the same constant.

**Non-Goals:**

- Not changing coverage. `budgetsGovernedBy` keeps returning every budget at the node, and the
  invariant that every `ACTIVE` budget is governed is untouched.
- Not changing what the detail screen lists as governed budgets. A reader looking at a point should
  still see the rejected row sitting under it — that is how the phantom is recognised.
- Not reversing spending that a phantom ceiling let through. See the proposal.
- No new endpoint, DTO, entity, migration or permission code, and no frontend change.

## Decisions

**Filter in the three summing methods, not in `budgetsGovernedBy`.** Putting the predicate in the
coverage walk is the smaller diff and the wrong one: it would silently change the coverage
invariant's meaning (an `ACTIVE` budget's governance is asserted through that same method), shrink
`governedBudgetIds` on the list read, and drop the rejected row from the detail screen — removing
the evidence a reader needs to understand why a ceiling moved. Governing and counting are different
questions; only one of them is about money.

**Import `isCountedBudget` from `@erp/shared` rather than declaring a status list in the backend.**
The client and the server disagreeing about which budgets are money is precisely the defect; a
second copy of the list is how they would drift apart again. `@erp/shared` is already a backend
dependency.

**Count every governed budget's `budget_txn` rows, whatever the status.** Asymmetric on purpose, and
the asymmetry is the load-bearing decision here. A ceiling states what was appropriated; the ledger
states what has been committed against it. A budget moved out of `ACTIVE` while holding an
outstanding RESERVE has not released it — nothing wrote a RELEASE — so dropping its rows would raise
the group's available by money that is still held. Only `ACTIVE` budgets are selectable, so today
`DRAFT` and `REJECTED` carry no rows and the choice is invisible; `INACTIVE` is reachable from the
edit form's status picker and would make it visible the first time it is used.

Alternative considered: exclude a non-counted budget entirely, rows and all. Rejected — it makes
available depend on the order in which somebody flips a status, which is not a property money
should have.

**Do the filtering after the entity load, not in the query.** All three methods already load the
`Budget` entities they sum; the status arrives with them. A `status` predicate in the `find` would
also drop the rows from `usedById`/`txns`, which is the behaviour just rejected above.

### Ledger and transactions

This change writes nothing. No `budget_txn` row is created, updated or read differently — the same
rows are summed, and one addend is dropped from the ceiling beside them.

The sequence it participates in is unchanged and worth stating because it is the one that matters:
`BudgetLedgerService.reserveIn` runs inside `inTransaction`, takes `LockMode.PESSIMISTIC_WRITE` on
every governing control point via `lockControlPoints` **before** reading any balance, then calls
`balanceAt` and evaluates the ladder inside that lock, then inserts the RESERVE rows. The corrected
ceiling is read at the same point in that sequence as the wrong one was; no lock is added, moved or
released differently, and the concurrency test that pins two submissions racing for the last of a
budget continues to exercise the same path.

The one behavioural consequence to expect: a control point that was over-spent through a phantom
ceiling now reads negative available, and the next submission against it is refused where before it
was accepted. That is the fix working.

## Risks / Trade-offs

**A ceiling drops and a point goes negative on deploy** → Real, and correct. Exposure was measured
before proposing: in the customer database one active control point counts one `REJECTED` budget,
for 23,056,000, and it is the row this investigation created. Nine other `REJECTED` budgets
(12,056,056,000) and three `DRAFT` (1,780,000,000) sit at nodes no control point governs yet, so they
change nothing today — and would have started inflating a ceiling the moment one was minted over
them, which is the reason to fix this before the 92 unfunded lines are entered.

**`isCountedBudget` takes a plain `string`** → Deliberate in the shared package (a status outside
every declared list is reachable), and it means an unknown status counts as not-money. For a ceiling
that is the safe direction: an unrecognised status grants no room rather than unlimited room.

**Someone later "simplifies" the asymmetry** → The spec scenario pinning an `INACTIVE` budget's
50,000 reservation against a 1,000,000 ceiling exists to fail when they do.

## Migration Plan

None. No schema change and no data change. Deploy is a backend release; rollback is reverting it,
after which the phantom ceilings return.

Worth doing on the way out rather than as a migration: list the control points whose ceiling changes,
so finance is told rather than discovering it. The recursive query used to measure exposure for this
proposal is in the tasks.

## Open Questions

None. The `INACTIVE` treatment is decided above rather than deferred — it is unobservable today, and
deciding it while the reasoning is in front of us is cheaper than meeting it in production.
