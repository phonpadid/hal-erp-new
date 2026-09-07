## Context

`stores/budgets.ts` proposes a budget like this:

```
const budget = await budgetsApi.create(input);              // POST /budgets     → DRAFT budget
const { documentId } = await budgetsApi.createPlan({        // POST /budgets/plans → plan document
  departmentId: input.departmentId, lines: [{ budgetId: budget.id }],
});
```

Two commits, no relationship between them. `BudgetService.create` says so itself — "One insert, so
no explicit transaction: there is no second write that has to commit with it" — which was true of
that method and false of the operation it is half of.

The failure mode is not a lost budget but an unreachable one. The unique index
`budget_dimension_unique_unless_rejected` is on `(node_id, department_id) WHERE status <> 'REJECTED'`,
so the same dimension cannot be proposed twice; the app offers no delete, no way to set `REJECTED`,
and no second caller of `createPlan`. The only exits are SQL or the workaround that was actually
used here: call `POST /budgets/plans` by hand with the stranded budget's id.

That last fact is the useful one. The endpoint already accepts an existing budget — the whole
recovery is a call the product does not expose.

## Goals / Non-Goals

**Goals:**

- One act, one transaction: a proposed budget and its plan exist together or neither does.
- A stranded `DRAFT` has a way back through the product.
- The client stops sequencing two writes.

**Non-Goals:**

- Deleting budgets. They are financial records and the absence of a delete is deliberate; this
  change makes the bad state unreachable rather than removable.
- Changing what a plan is, how it routes, or what approving one does.
- Rescuing the one stranded row with a migration. The re-propose path clears it, and a migration
  that reaches into one customer's data to fix one row is worse than the button.

## Decisions

### The intake moves to the server, and the client makes one call

A new intake creates the budget and its plan inside one `em.transactional(...)`, returning the plan
document id the form already routes to.

*Alternative considered — keep two calls and have the client roll back by deleting the budget on
failure.* Rejected twice over: there is no delete endpoint, and a client-driven compensation fails
exactly when the client is the thing that failed.

*Alternative considered — leave it, and add a "clean up stranded drafts" screen.* Rejected: it
treats the symptom, and every user who hits the bug between now and then still meets a 500 with no
explanation.

### A plan-less DRAFT can be proposed again

The re-propose path takes an existing `DRAFT` budget and raises a plan for it — the call that was
made by hand to recover `1.106`, made available where a user can reach it.

Guarded to what it is for: the budget must be `DRAFT`, must belong to the active company, and must
have no plan already carrying it. Those three conditions are what distinguish a stranded budget from
one whose plan is simply waiting for an approver.

### The transaction boundary and the numbering lock

The combined intake takes one transaction. Inside it the plan issues its document number through
`NumberingService`, which locks `doc_running_number` with `PESSIMISTIC_WRITE` (invariant 7). That
lock is now held across the budget insert as well as the document insert — two inserts, no user
input, no external call between them. The budget insert must therefore stay inside the same
transaction and must not be moved after the numbering call in a way that lengthens the hold.

## Sequence: what writes `budget_txn`

Neither half of this writes `budget_txn`. The spec is explicit that submitting a plan reserves
nothing, and activation is what eventually writes rows — at approval, through the post-action, and
not here.

What this change does write, in one transaction:

1. `budget` row, status `DRAFT`.
2. `document` row for the plan, its number issued under the numbering lock.
3. `budget_movement` row per proposed budget, `ACTIVATE_BUDGET`, pointing at the budget from step 1.

A failure at any step leaves none of them.

## Risks / Trade-offs

- **[The numbering lock is held across one more insert]** → measurably: one row, no I/O between.
  Mitigation: keep the budget insert adjacent to the document insert inside the transaction, and
  keep the existing concurrency test on document numbering green.

- **[Re-propose is a new way to raise a plan]** → a second caller of `createPlan` is a second place
  the rules about who may propose must hold. Mitigation: it goes through the same intake and the
  same permission, and the three guards above make it refuse anything that is not a stranded draft.

- **[The stranded row on this database]** → it is one row, and the change gives it an exit rather
  than reaching in. Mitigation: named in the tasks so it is checked after deploy rather than
  forgotten.

## Migration Plan

No schema change. Deploy backend and frontend together — the client's single call needs the new
intake. Rollback is a revert; the two-call path still exists in the reverted client.

## Open Questions

None.
