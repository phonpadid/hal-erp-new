## Why

Proposing a budget is one act to the user and two requests to the server. The save button calls
`POST /budgets`, which inserts a `DRAFT` budget, and then `POST /budgets/plans`, which raises the
plan document that will activate it. Nothing binds them.

When the second call fails, the first has already committed. What is left is a `DRAFT` budget with
no plan — money that exists, cannot be spent, and cannot be got rid of:

- `budget_dimension_unique_unless_rejected` covers `(node_id, department_id)` for any status but
  `REJECTED`, so proposing the same line again is a unique violation surfaced as a 500.
- There is no delete endpoint for a budget, by design — budgets are financial records.
- `REJECTED` is the status that frees the dimension, and the edit form offers only `ACTIVE`,
  `INACTIVE` and `CLOSED`.
- `createPlan` is called from exactly one place: the create form. A draft that lost its plan cannot
  be re-proposed from anywhere in the app.

This is not hypothetical. It happened on this database: the company had no `ACTIVATE_BUDGET`
document type yet, the plan call answered 400, and budget `1.106` sat as an unreachable `DRAFT`
until the whole change was worked around by hand.

## What Changes

- Proposing a budget becomes one server-side unit of work: the budget and its plan document are
  created in one transaction, and a failure in either leaves the company as it was.
- The client makes one call. It no longer sequences two writes and hopes.
- A `DRAFT` budget that has no plan — one already stranded, or one made by an API caller doing the
  two steps itself — SHALL be re-proposable, so the state has an exit that does not require SQL.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `budget-control`: "Budget Plan Intake" gains the atomicity requirement — a proposed budget and
  its plan are created together or not at all — and a requirement that a plan-less `DRAFT` budget
  can be proposed again.
- `web-budgets`: "Budget Create and Edit" saves through the single call rather than sequencing two.

## Impact

- **Capabilities touched**: `budget-control` (intake), `web-budgets` (the form's save).
- **Invariant risk**: this is the invariant-9 shape from `CLAUDE.md` — a unit of work that writes
  budget rows belongs in one `em.transactional(...)`. The budget insert and the plan document were
  outside one; that is the defect.
- **Append-only ledger (INVARIANT 2)**: untouched. A plan writes no `budget_txn`; the ledger rows
  arrive at approval, and nothing here changes that.
- **Numbering (INVARIANT 7)**: the plan issues a document number under the existing pessimistic
  lock. Folding the two calls into one transaction must not hold that lock longer than the numbering
  service already does.
- **Code**: `BudgetService.create`, `BudgetPlanService.create`, a combined intake for the two, the
  budgets store in the web app, and the create form's save.
- **Data**: one stranded `DRAFT` may exist on this database from the original failure. The
  re-propose path is what clears it; no migration.
