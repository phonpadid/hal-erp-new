## Why

A budget the company refused still grants room to spend.

A control point's ceiling is the sum of `amount_total` over every budget it governs, taken with no
regard for `budget.status`. A `REJECTED` budget — one a plan refused — therefore raises the ceiling
of the point governing its node, and its siblings may spend the money nobody approved.

Reproduced against the customer database on 2026-09-10. Node `6.111` held one `ACTIVE` budget of
`0` and one `REJECTED` budget of `23,056,000`. The governing control point reported:

```
amountTotal 23,056,000 · governedBudgetCount 2 · available 23,056,000
```

A 23,056,000 expenditure document was then submitted against that zero budget under a
`BLOCK at 100` ladder and was **accepted** — the ladder was working exactly as written, against a
ceiling that should have been zero.

This is reachable through ordinary use, not through misuse. The dimension index refuses only a
second *live* budget on a node, so a proposal that is rejected leaves its row behind and a
re-proposal is allowed; every rejected attempt at a node that already has a control point adds its
figure to that point's ceiling permanently. Correcting a wrong amount by cancelling and
re-proposing — the normal path, and the only one, since `amount_total` is never overwritten — is
what triggers it.

The rule the system already believes is written down: `COUNTED_BUDGET_STATUSES = ['ACTIVE',
'CLOSED']` in `@erp/shared`, used by the web app for every total it shows. The server path that
decides whether spending is refused is the one place that does not consult it.

Exposure in the customer database today is one control point and 23,056,000 — the row this
investigation created. Nine other `REJECTED` budgets totalling 12,056,056,000 and three `DRAFT`
totalling 1,780,000,000 sit at nodes no control point governs yet, and would begin inflating a
ceiling the moment one is minted over them. The 92 unfunded 2026 lines are about to be entered one
by one, each through propose-and-approve; the pattern that produces this is the pattern that work
consists of.

## What Changes

- A control point's ceiling SHALL count only budgets whose status is counted — `ACTIVE` or
  `CLOSED`. A `DRAFT`, `REJECTED` or `INACTIVE` budget contributes nothing to it.
- The same rule applies wherever that ceiling is derived: the single-point balance, the batched
  list read, and the breakdown behind the control point detail screen. All three sum the group's
  `amount_total` today, and they must never disagree.
- `used` continues to count the ledger rows of **every** budget the point governs, whatever its
  status. Money committed is committed; a budget that leaves `ACTIVE` carrying reservations does not
  release them by changing status, and dropping its rows would hand the group back money it is still
  holding. Today no non-`ACTIVE` budget has a ledger row — only `ACTIVE` budgets are selectable — so
  this is stated for `INACTIVE`, which the status table permits and nothing has produced yet.
- Which budgets a control point *governs* is unchanged. Coverage answers "is this budget checked by
  anything", and an `ACTIVE` budget must still be covered (invariant: every active budget is
  governed). Only the money arithmetic changes.

**No frontend change.** The web app already applies `isCountedBudget` to what it totals; it reads
the corrected figures from the same endpoints.

## Capabilities

### New Capabilities

None. The ceiling already exists; what it counts is the change.

### Modified Capabilities

- `budget-control`: the derived ceiling at a control point excludes budgets that are not money, and
  the availability check that gates a submit is evaluated against that corrected ceiling.

## Impact

- `back/src/modules/budget/budget-balance.service.ts` — `balanceAt`, `balanceAtMany` and
  `breakdownAt`, the three places a group's `amount_total` is summed.
- Every caller that reads a ceiling: `BudgetLedgerService.reserveIn` (the submit-time refusal),
  `BudgetControlPointService` list and balance reads, and the coverage report.
- `back/src/modules/budget/budget-coverage.service.ts` — read, not changed. Stated here because the
  obvious place to put a status filter is `budgetsGovernedBy`, and that is the wrong place: it would
  also change what "governs" means to the coverage invariant and to the detail screen's list of
  governed budgets.
- No migration, no entity, no DTO, no endpoint, no permission code.

### Invariants

Invariant 3 (derived balances) is what this restores: the balance is derived from the ledger and
from the money that was actually appropriated, and a refused appropriation is not money. Nothing
here writes `budget_txn`, so the append-only ledger (invariant 2) is untouched, and no existing row
changes meaning — the same rows are read, and one wrong addend is dropped from the ceiling.

### What This Does Not Fix

A ceiling that drops when a rejected budget stops counting can put a control point below what is
already committed against it, if anything was spent while the phantom ceiling was in force. That is
a correction surfacing, not a new fault, and the affected point simply reads negative — which is
what an overspend has always looked like here. This change does not reverse such spending, and
should not: the documents were approved by people, and unwinding them is an adjustment somebody
signs, not a migration.
