## Context

`BudgetQuarterService` scans `budget_txn` once per read, keeps the `RESERVE` and `RELEASE` rows to
build `Σ RESERVE − Σ RELEASE` per quarter and per month, and discards the rest. It then measures
that consumption against `budget.amount_total`, read straight off the row
(`budget-quarter.service.ts` — `figureFor(b.id, b.amountTotal, …)`, and the department roll-up sums
the same column). `ADJUST_INCREASE`, `ADJUST_DECREASE`, `TRANSFER_IN` and `TRANSFER_OUT` never
reach the figure, because `amount_total` is never rewritten — CORE INVARIANT 3 forbids it, and
`BudgetService.update` correctly refuses to touch it.

The budget's own detail page does the arithmetic properly: it calls `BudgetBalanceService`, which
sums the ledger and returns the balance INVARIANT 3 defines. So the two screens read the same rows
and state different money. Budget 1.106 (ADM, FY2026) shows 112,004,000 on its page and 12,000,000
on the quarterly report.

The quarter columns for that budget are also four zeros, because no expenditure has been loaded.
That is deliberately left alone here: both importers create departments from the workbook's PLAN
codes (`1`, `3`, `7` …) and the company's real departments are `ADM`, `MK`, `WH`, so a run today
would raise a second department for every one that already exists. That question is its own change;
this one stops at the figure the report measures against.

Constraints: the read is on a screen a user waits for, so the fix must not turn one scan into a
query per budget. `budget_txn` is append-only (INVARIANT 2) — nothing here rewrites history.

## Goals / Non-Goals

**Goals:**

- One definition of a budget's money in the system, used by both the detail page and the quarterly
  report, so they cannot disagree again.
- The quarterly report's shares, remainders and overspent flags computed against the budget as it
  now stands.

**Non-Goals:**

- Per-quarter budget allocations. The spec already forbids deriving one and this change does not
  introduce one; only the annual denominator moves.
- Any change to how consumption is defined, attributed to quarters, or compared between them.
- Loading FY2026 expenditure, and anything about how the importers name departments. Blocked on a
  question this change does not need answered.
- Rewriting `amount_total` to "simplify" the read. That is the thing INVARIANT 3 exists to prevent.

## Decisions

### Fold the balance out of the scan that is already running, using the shared direction

The read already loads *every* `budget_txn` row of every budget in the fiscal year — one query,
`{ budget: { $in: … } }`, no type filter — and then keeps only `RESERVE` and `RELEASE` from it. The
adjustment and transfer rows are already in memory and are being thrown away.

So the fold happens in that same pass. The direction of each row is not decided here: it comes from
`budgetTxnDirection` in `@erp/shared`, the classification `BudgetBalanceService` itself reads —
`ADJUST_INCREASE`/`TRANSFER_IN`/`RELEASE` add, `ADJUST_DECREASE`/`TRANSFER_OUT`/`RESERVE` subtract,
`ACTUAL` converts and moves nothing. Seeded with `amount_total`, that yields the balance of
INVARIANT 3 — the row's remaining amount — and the ceiling is it plus what the year consumed:

```
remaining      = amount_total folded over its ledger rows via budgetTxnDirection
annualBudget   = remaining + yearConsumed      // yearConsumed = Σ RESERVE − Σ RELEASE
```

*Alternative considered — call `BudgetBalanceService.availableFor(budgetIds)`.* This was the
decision when this document was first written, on the grounds that a service call cannot drift.
Implementation showed the price: `availableFor` issues two more queries, and one of them is a
second full scan of `budget_txn` for the same budgets. That doubles the heaviest read in the system
to restate a number the report is already holding, and breaks the existing test that pins this read
at five queries "regardless of the periods AND regardless of the filters". Rejected on that cost.

The drift the rejected option was protecting against is answered a better way: the only thing that
could drift is the DIRECTION of a transaction type, and that lives in exactly one place for exactly
this reason — the comment on `applyToBalance` records it being spelled out in five places once, four
agreeing and the fifth drawing a settlement as a withdrawal. Reporting reads that same function, and
a test asserts the read agrees with `BudgetBalanceService` for a budget carrying every movement type.

*Alternative considered — write adjustments back into `amount_total`.* Rejected outright:
INVARIANT 3 states the balance is derived and `budget.amount_total` is never overwritten to reflect
usage or movement.

### The department figure is the sum of its lines' figures

Both the ceiling and the remainder roll up by summing the lines, never by a separate query at
department level. The spec already requires a department to carry the same figures as its lines;
summing the same numbers is the only way that cannot drift.

### Zero means zero on the ledger

`overspent` and the "no share of nothing" rule key off the derived ceiling, not `amount_total`. A
budget raised at zero and since adjusted upwards is a real budget; one adjusted back down to nothing
is a zero budget. This falls out of the decision above at no extra cost.

### The screen names the column for what it now holds

The annual column is labelled as the budget as it stands rather than as the amount raised. Without
that, a reader holding the printed plan sees 112,004,000 where the plan says 12,000,000 and
concludes the report is broken — the same confusion in the opposite direction.

## Sequence: what writes `budget_txn`

Nothing in this change does. `BudgetQuarterService` opens no transaction, persists nothing, and
gains no writes here — it reads rows it was already reading and adds them up differently. No
transaction boundary and no locking are introduced, because no unit of work is.

## Risks / Trade-offs

- **[A `budget_txn` dated outside the fiscal-year windows lands in the ceiling but not in
  consumption]** → the fold walks every row the scan loaded, while consumption only counts rows the
  quarter windows attribute. Any row outside those windows would be absorbed into
  `annualBudget = remaining + yearConsumed` and quietly inflate the denominator. In practice a
  budget belongs to one fiscal year and its movements sit inside it. Mitigation: a test that dates a
  `RESERVE` outside the year's windows and pins what the read reports, so the behaviour is a
  decision on record rather than an accident.

- **[The read gains no query, so nothing pins that it stays that way]** → the fold is free today
  because it rides the existing scan, and a later hand could "tidy" it into a service call without
  noticing the cost. Mitigation: the test that pins this read at five queries stays, and the spec
  states the second scan is forbidden rather than merely undesirable.

- **[Every consumer of the quarterly read sees a different `amountTotal`]** → this is the intended
  break, and it is a break. Mitigation: the field keeps its name and meaning ("the budget this row
  is measured against"), the front-end label changes with it, and the spec delta records the new
  definition so the archive shows when the number moved and why.

- **[The screen still shows four empty quarters]** → nothing has been spent against 1.106 in this
  system, and the workbook's expenditure is not loaded. The report is now honest about the ceiling
  and silent about the floor. Mitigation: none available here — say so plainly rather than let a
  reader take four zeros for "nothing was spent".

## Migration Plan

No schema migration; the read model changes and no stored data is rewritten. Deploy is a normal
backend deploy, and rollback is a revert — nothing on disk has changed shape.

## Open Questions

None left in this change. The two that were open — how much of the workbook to load, and whether
historical spend should appear as documents nobody approved — moved out with the import work, and
a third joined them: whether the importers should map a plan code onto an existing department
instead of creating one named after the code.
