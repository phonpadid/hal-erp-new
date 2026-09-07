## Why

`budget.status` decides whether money exists. `ACTIVE` and `CLOSED` are counted into every balance
and rollup; `DRAFT` and `REJECTED` are not, and `REJECTED` is the one value that frees a line's
`(node_id, department_id)` slot so a refused line can be proposed again. Every spec statement
treats `REJECTED` as terminal, and two runtime guards enforce that at the front door —
`raisePlan` and `repropose` both refuse a budget that is not `DRAFT`.

The column behind all of it is an unconstrained `varchar(255)` with no CHECK, mapped to a plain
`string`, and two writers reach it with no transition rule at all:

1. **`PATCH /budgets/:id` writes whatever it is given.** `budget.service.ts:177` is
   `if (dto.status !== undefined) budget.status = dto.status;` — no read of the current status, no
   allow-list. The DTO validates `@IsString() @MaxLength(50)`, and the shared schema agrees
   (`z.string().max(50)`). A `BUDGET_MANAGE` holder can move a budget from `REJECTED` to `ACTIVE`,
   or write a status no part of the system declares, through the ordinary edit form. Contrast the
   *filter* DTO on the same module, which is properly constrained with `@IsIn([...BUDGET_STATUSES])`
   — the read is stricter than the write.

2. **Approval can revive a rejected budget.** `RETURN` runs the same hold-release hook as `REJECT`
   and `CANCEL`, so returning a plan marks its `DRAFT` budgets `REJECTED` and then puts the document
   back to `DRAFT` for the requester to correct. On resubmission and full approval, `activate` loads
   its budgets by movement id **with no status filter** and sets every one of them `ACTIVE`
   (`budget-plan.service.ts:462`, `:501`). Return → correct → resubmit → approve is therefore a
   complete `REJECTED` → `ACTIVE` cycle that no requirement permits and no test covers.

The second one is worse than a stray transition: returning a plan is supposed to mean *fix this and
send it back*, and it currently destroys the budgets the plan exists to propose. At HAL this has
never fired — the `approval_log` holds 232 `APPROVE` and 5 `CANCEL` rows and not one `RETURN` — so
the bug is latent, and the moment somebody uses the return button they will either lose a plan's
budgets or revive rejected ones, depending on what they do next.

There is a third, smaller inconsistency in the same area: `INACTIVE`. It is absent from
`BUDGET_STATUSES`, the budget edit form offers it, and a front-end test pins its behaviour (an
`INACTIVE` budget is not counted). It is a real status the declared list does not admit, which is
exactly what an unvalidated write column allows.

## What Changes

- **`RETURN` no longer marks a plan's budgets `REJECTED`.** Marking them is the response to a
  *terminal* outcome — `REJECT` and `CANCEL` — not to a document being handed back for correction.
  A returned plan keeps its `DRAFT` budgets, so the correction it asks for is possible at all.
  Budget, quota and stock holds are still released on `RETURN`, exactly as now: the document is no
  longer in flight and must hold nothing.
- **`activate` refuses a budget that is not `DRAFT`**, naming the budget and the status it is in.
  This mirrors the refusals `raisePlan` and `repropose` already make, and it is the backstop that
  makes `REJECTED` terminal in code and not only in prose. Nothing legitimate reaches it: a plan
  can only carry budgets that were `DRAFT` when it was raised.
- **`PATCH /budgets/:id` validates the status and the transition.** The value must be a declared
  status, and the move must be one the lifecycle allows:
  - `ACTIVE` ⇄ `INACTIVE` — suspend a budget and put it back
  - `ACTIVE` → `CLOSED` and `INACTIVE` → `CLOSED` — retire it
  - everything else refused, naming both statuses. In particular `REJECTED` is terminal, `DRAFT` is
    reachable only by proposing, and `CLOSED` is left to the fiscal-year close that sets it.
- **`INACTIVE` is declared.** It joins `BUDGET_STATUSES` as the fifth value, with `isCountedBudget`
  unchanged — it stays out of every total, as the existing test already asserts. Declaring it is
  what lets the transition rule above be written as an allow-list rather than a list with a hole
  in it, and it makes the status filter offer what the edit form can actually set.
- **A CHECK constraint on `budget.status`** admits only the five declared values. The application
  guard is the one that gives a good refusal; the constraint is what makes an undeclared status
  unrepresentable regardless of which writer is at fault.

Explicitly out of scope: changing what `REJECTED` means or adding a way to undo it — the sanctioned
recovery stays "propose the line again", which works because a `REJECTED` row frees its dimension
slot. Also out of scope: the fiscal-year close/reopen writers, which already filter on the status
they move and are correct.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `budget-control`: the budget edit write validates status and refuses an illegal transition;
  `INACTIVE` becomes a declared status; plan activation refuses a budget that is not `DRAFT`;
  returning a plan leaves its budgets `DRAFT` (Requirements: Budget Plan Activation, Budget Plan
  Rejection Frees the Proposed Lines, and the budget update surface).
- `approval-workflow`: the marking of a plan's budgets as `REJECTED` is tied to a terminal outcome
  (`REJECT`, `CANCEL`) rather than to hold release, so `RETURN` releases holds without rejecting the
  budgets (Requirement: Reject Returns and Releases).
- `web-budgets`: the budget edit form offers only the statuses the current status can legally move
  to (Requirement: the budget edit surface).

## Impact

**Schema** — one migration adding a CHECK constraint on `budget.status` for the five declared
values. The database holds 230 `ACTIVE`, 5 `REJECTED` and 1 `DRAFT` and no undeclared value, so the
constraint applies without a backfill. `down` drops it.

**Backend** — `budget.service.ts` (the update path and a transition table), `dto/budget.dto.ts`
(`@IsIn([...BUDGET_STATUSES])` on the update DTO), `budget-plan.service.ts` (`activate` status
guard), `document-submit.service.ts` (`releaseDocumentHolds` stops calling `markRejected`) and
`approval-routing.service.ts` (the `REJECT` and `CANCEL` paths call it instead).

**Shared** — `BUDGET_STATUSES` gains `INACTIVE`; `COUNTED_BUDGET_STATUSES` and `isCountedBudget`
are unchanged; the budget update schema's `status` narrows from `z.string().max(50)` to the enum.

**Frontend** — `BudgetFormView.vue` derives its status options from the current status rather than
offering a fixed three; `BudgetListView.vue`'s filter picks up `INACTIVE` automatically from the
declared list; i18n already has the `INACTIVE` label in all three locales.

**Invariants** — invariant 5 is preserved and made exact: reject and cancel still always release
budget and quota, and `RETURN` continues to release them too; only the plan-specific rejection
moves. `budget_txn` is untouched — no path here writes or reads the ledger, and a status is not a
balance (invariant 3). Company scoping and permission-code authorization are unchanged;
`BUDGET_MANAGE` still gates the edit, it simply can no longer author any status it likes.

**Concurrency** — the status write is a single-row update inside the existing request; it reserves
no budget and issues no number, so no new lock or concurrency test is owed. The activation guard sits
inside the transaction `activate` already runs under.
