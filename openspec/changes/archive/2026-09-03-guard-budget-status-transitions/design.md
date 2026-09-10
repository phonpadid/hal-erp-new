## Context

Five values reach `budget.status` today: `DRAFT`, `ACTIVE`, `REJECTED`, `CLOSED` from
`BUDGET_STATUSES`, and `INACTIVE`, which the shared package documents as a value that "exists in
this system and appears in no declared list". The column is `varchar(255)` with no CHECK
(`Migration20260617000000.ts:31`) mapped to a plain `string`.

Who writes it today:

| Writer | Guard |
|---|---|
| `BudgetService.draftFor` — writes `DRAFT` | n/a, it creates the row |
| `BudgetPlanService.activate` — writes `ACTIVE` | fiscal year must be `OPEN`; **no budget-status filter** |
| `BudgetPlanService.markRejected` — writes `REJECTED` | `status: DRAFT` in the query, so it is idempotent |
| `AccountingPeriodService` close/reopen — `ACTIVE` ⇄ `CLOSED` | filters on the status it moves; correct |
| `BudgetService.update` — writes **anything** | **none** |

Who refuses a non-`DRAFT` budget today: `raisePlan` and `repropose`, both with a message naming the
offending status. `activate` — the one that grants force — does not.

The partial unique index `budget_dimension_unique_unless_rejected` on
`(node_id, department_id) WHERE status <> 'REJECTED'` is what makes `REJECTED` the status that
frees a line. Any change here has to keep that meaning intact.

Two live facts shape the design. The HAL database holds 230 `ACTIVE`, 5 `REJECTED`, 1 `DRAFT` and no
undeclared value. Its `approval_log` holds 232 `APPROVE` and 5 `CANCEL` and **zero** `RETURN`, so the
return-path defect has never fired in production data.

## Goals / Non-Goals

**Goals:**

- `REJECTED` is terminal in code, not only in prose.
- Returning a plan means "correct this", and leaves the budgets to correct.
- A status write states what it is allowed to be and refuses the rest, naming both statuses.
- `INACTIVE` is either declared or gone — not a value the product offers and the model denies.
- An undeclared status is unrepresentable in the database whichever writer is at fault.

**Non-Goals:**

- Adding a way to un-reject a budget. The recovery is to propose the line again, which the freed
  dimension slot already allows.
- Changing what is counted. `isCountedBudget` stays the `ACTIVE`/`CLOSED` allow-list.
- Touching `budget_txn`, balances, or the reserve/actual/release chain. A status is not a balance.
- Reworking fiscal-year close/reopen, which already filters correctly.

## Decisions

### `markRejected` moves from hold release to the terminal outcomes

Today `REJECT`, `CANCEL` and `RETURN` all funnel into `DocumentSubmitService.releaseDocumentHolds`,
which releases budget, quota and stock and then calls `BudgetPlanService.markRejected`. The first
three belong together — a document not in flight holds nothing — but the fourth is a different kind
of statement. Releasing a hold is reversible bookkeeping; marking a budget `REJECTED` is a verdict
on a proposal.

`markRejected` therefore moves to the two paths that carry a verdict: the `REJECT` branch of
`ApprovalRoutingService.act`, and the withdrawal path. `RETURN` keeps every release and gains
nothing else.

*Alternative — pass the action into `releaseDocumentHolds` and branch inside it:* rejected. It keeps
a verdict inside a function named for bookkeeping, and the next person adding a caller has to know
which string to pass to avoid destroying budgets. Moving the call puts it where the decision is.

*Alternative — leave `RETURN` as it is and let `activate` tolerate `REJECTED`:* rejected outright.
That is the current behaviour, and it is the bug: it makes the return button destroy a plan's
budgets and then quietly resurrect them.

### `activate` refuses a non-`DRAFT` budget rather than filtering it out

The guard throws, naming the budget and its status; it does not skip the offending row and activate
the rest. A plan is one proposal — activating half of it, silently, would leave a document reading
as fully approved over budgets that were never put in force.

This makes `activate` consistent with `raisePlan` and `repropose`, which already refuse on the same
condition with the same shape of message. With the return-path fix above, nothing legitimate can
reach it: a plan can only carry budgets that were `DRAFT` when it was raised, and no path now moves
them out of `DRAFT` while the plan is in flight. It is a backstop, and backstops that never fire are
the point.

### The transition rule is an allow-list of pairs, not a list of forbidden moves

```
ACTIVE   → INACTIVE, CLOSED
INACTIVE → ACTIVE,   CLOSED
DRAFT    → (nothing by hand)
REJECTED → (nothing, ever)
CLOSED   → (nothing by hand)
```

A deny-list would have to be revisited every time a status is added, and it fails open — the exact
failure mode that admitted `INACTIVE` in the first place. `the-tree-totals-only-money.spec.ts`
already records this lesson for counting: "An allow-list decides this. A deny-list of DRAFT/REJECTED
would have admitted INACTIVE."

`DRAFT` and `CLOSED` are not hand-settable. `DRAFT` is what proposing a budget writes, and letting
someone type it would create a budget no plan carries — the stranded state `propose` exists to
prevent. `CLOSED` is written by the fiscal-year close, which sets it for a whole year at once; a
budget closed by hand inside an open year would be a balance nobody could explain. Re-writing a
status onto itself is a no-op, not a refusal.

### `INACTIVE` is declared rather than removed

It has a coherent meaning the product already relies on — a budget temporarily suspended, still
counted out of totals, unspendable because `document.service.ts` requires `ACTIVE` — and both the
edit form and a front-end test already treat it as real. Removing it would delete a capability
people use; declaring it makes the model tell the truth.

`COUNTED_BUDGET_STATUSES` and `isCountedBudget` do not change: `INACTIVE` stays out of every total.
The visible consequence is that the list view's status filter gains an `INACTIVE` option, which is
correct — a status the app can set should be a status the app can filter by.

### The CHECK constraint is a backstop, not the guard

The service raises the refusal a person reads; the constraint makes an undeclared value impossible
regardless of which writer is at fault. Both are cheap and they fail differently: a service guard
can be bypassed by a new code path, a constraint cannot, and a constraint alone would answer a typo
with a driver error instead of a sentence.

## Risks / Trade-offs

- **Moving `markRejected` could leave a withdrawn plan's budgets `DRAFT` if a path is missed** →
  There are exactly two terminal paths for an unapproved document, reject and withdraw, and both get
  the call plus a test asserting the budgets end `REJECTED`. A test also asserts that `RETURN` leaves
  them `DRAFT`, which is the behaviour being introduced.
- **A budget left `DRAFT` by a returned plan still holds its dimension slot**, so the same line
  cannot be proposed twice while a returned plan is being corrected → That is correct and is the
  point: the returned plan is still about that line. The plan's own document carries it, and
  `repropose` exists for the case where no plan does.
- **Declaring `INACTIVE` widens the declared set**, and anything iterating `BUDGET_STATUSES` gains a
  value → The two consumers are the list filter (wants it) and `isCountedBudget`, which is an
  allow-list and is unaffected by definition.
- **The transition rule may refuse a move somebody performs today by hand.** The only such moves are
  ones the lifecycle does not sanction, and the refusal names both statuses, so a legitimate need
  surfaces as a conversation rather than as a silent status rewrite.

## Migration Plan

One migration adds the CHECK constraint; `down` drops it. No backfill: the database holds no
undeclared status. Deploy order does not matter — the constraint admits everything the current code
writes, so the migration is safe before or after the application change.

## Sequencing and transactions

No path in this change writes `budget_txn` or `quota_usage`, reserves budget, or issues a document
number. The `activate` guard runs inside the transaction `activate` already holds, before any status
is written, so a refused plan leaves nothing behind. `markRejected` keeps running inside the
approval transaction that makes the terminal transition, so a budget cannot be marked by a rejection
that then rolls back. The edit-path guard is a single-row read-then-write inside one request; no lock
is introduced and none is owed.

## Open Questions

- Whether `CLOSED` should be hand-settable for a budget that ends before its fiscal year does. This
  change refuses it, on the grounds that the close is a year-level event; if the company needs to
  retire one budget early, `INACTIVE` says that without claiming the year is over.
