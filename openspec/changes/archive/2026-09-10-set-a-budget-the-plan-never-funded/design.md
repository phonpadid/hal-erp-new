## Context

Two client-side refusals stand between a budget officer and work the server would accept.

`budgetCreateSchema.amountTotal` in `shared/src/index.ts` is `z.string().refine(isPositive)`, and
`isPositive` requires `Number(v) > 0`. The backend's `CreateBudgetDto.amountTotal` is
`@IsNumberString()`, which accepts `"0"`. The schema is consumed only by
`front-end/src/views/budgets/BudgetFormView.vue` — the backend does not import it — so the two
validators were never a shared source of truth for this field; they were two rules, and the stricter
one is on the side that cannot enforce anything.

`ControlPointDetailView.vue` and `ControlPointListView.vue` render `cp.tolerance` and offer nothing
that writes. `PATCH /budgets/control-points/:id` accepts `UpdateControlPointDto.tolerance` behind
`BUDGET_MANAGE`, validated by `ToleranceLadder.parse`, which refuses an empty ladder, a non-finite
or negative `at`, and an action outside `WARN | BLOCK`. `budgetsApi` has no method for it.

Both screens already read what they need. Nothing about the ledger, the coverage rules, the numbering
locks or the approval chain is involved.

## Goals / Non-Goals

**Goals:**

- A `BUDGET_MANAGE` holder can propose a budget of `0` from the form, and is told what zero does
  before saving.
- A `BUDGET_MANAGE` holder can set a control point's tolerance ladder from the detail screen and
  from a list row.
- The client refuses exactly what the server refuses — no more, no less — so no affordance answers
  400 and no request the server would honour is blocked before it is sent.

**Non-Goals:**

- No backend change. No new endpoint, DTO, entity, migration or permission code.
- Not creating or deactivating control points from the UI. Coverage is minted when a plan is
  approved; a hand-created point is a different decision with a different failure mode, and nobody
  has asked for it.
- Not editing `cap_amount`. Only `NULL` is supported today (the DBML says so), and offering a field
  with one legal value teaches the wrong thing.
- Not fixing the ceiling rollup that counts `DRAFT` and `REJECTED` budgets. Separate change; see the
  proposal.
- Not relaxing the positive-amount rule for transfers or adjustments. A movement of nothing moves
  nothing; a budget of nothing is a real budget.

## Decisions

**Change `isPositive` usage rather than `isPositive` itself.** `budgetTransferSchema.amount` and the
adjustment schema share the helper and must keep rejecting zero. Introduce a second predicate for
non-negative decimal strings and use it only on `budgetCreateSchema.amountTotal`. Alternative
considered: parameterise `isPositive`. Rejected — a boolean argument at three call sites is how the
transfer rule loosens later by accident.

**Keep the zero-amount notice in the form, not in the resolver.** It is guidance, not validation:
the save must go through. Rendering it from the form's own reactive amount keeps the resolver a pure
validator, which is what lets the same resolver run in a test without a component.

**Edit the ladder in a dialog, opened from both screens, sharing one component.** The list needs a
per-row affordance and the detail needs an inline one; a shared dialog gives one place where the
rung rules live. Alternative considered: inline editing in the detail page only, with the list
linking to it. Rejected — setting a fiscal year's ladders is the actual task, and it is a task about
many points, not one.

**Mirror `ToleranceLadder.parse` in the client, and do not go further.** The client refuses an empty
ladder, a non-numeric, negative or non-finite threshold, and nothing else. It does not sort,
deduplicate, cap `at` at 100, or reject a `WARN` above a `BLOCK`: `ToleranceLadder.evaluate` applies
every matched rung and lets a matched `BLOCK` win, so order carries no meaning and a threshold above
100 is a legitimate allowance. A client that normalises would save a ladder the reviewer did not
write.

**Warn about a would-refuse-everything ladder; never block it.** The screen already has the point's
ceiling from the balance read it renders. When the ladder being saved has a `BLOCK` rung whose
threshold, applied to that ceiling, is at or below zero, say what it will do. Freezing a line
deliberately is legitimate — a closed project, a line under investigation — and only the person
saving knows which case this is.

**Refresh the edited row from the response, not by reloading the list.** The update returns the
control point; the store replaces that row. Reloading a filtered, paged list after an edit loses the
reader's position for no gain.

### Ledger and transactions

Nothing in this change writes `budget_txn` or `quota_usage`, reserves budget, or issues a document
number. There is no new transaction boundary and no new lock.

What the change alters is which requests can be *made*. Two downstream paths deserve naming because
this change makes them reachable from the UI for the first time:

- A budget of `0` reaching `ACTIVE` goes through `BudgetPlanService.activate`, unchanged: the plan's
  budgets flip to `ACTIVE` and the deduplicated missing control points are minted inside one
  `em.transactional`, with coverage re-verified from the database before commit. A zero amount
  changes no step of that sequence.
- A saved ladder is read by `BudgetLedgerService.reserveIn` at the next submit, which locks the
  governing control points with `LockMode.PESSIMISTIC_WRITE` before reading any balance and
  evaluates the ladder inside that lock. The ladder is configuration, not a ledger row, so it is
  updated in place (the DBML says so explicitly); a submit in flight either took the lock before the
  update committed and sees the old ladder, or after and sees the new one. There is no third
  outcome, and no ledger row is written by the update itself.

## Risks / Trade-offs

**A zero budget reaching `ACTIVE` under a `BLOCK` ladder refuses every document, including the
backdated one recording spending that already happened** → This is the trap the change exists to
make visible. Two notices, at both ends: the budget form says it when zero is entered, the ladder
editor says it when the ladder would do it. Neither prevents the save.

**Loosening the amount rule could be read as loosening it for movements too** → The transfer and
adjustment schemas keep the positive predicate, and a test asserts that each still refuses zero.

**A `WARN` ladder set widely turns budget control into budget reporting** → Real, and not this
change's call to make. The ladder is per control point, the screen shows which budgets each point
governs, and the audit report already reads ladders. Setting the policy is the organisation's
decision; this change only stops that decision from requiring an engineer.

**The client and `ToleranceLadder.parse` drift** → The rules are small and stated in the spec's
scenarios. A refused save surfaces the server's message with the editor still open and the rungs
intact, so drift shows up as a visible refusal rather than as lost input.

## Migration Plan

None. No schema change, no data change, no API version. Existing budgets, ladders and control points
are untouched; the change is what the UI will now let a user do to them.

Rollback is reverting the frontend and shared build. Any budget of `0` or ladder saved before a
rollback stays valid — both were reachable through the API before this change and remain so after.

## Open Questions

None blocking. One worth asking the customer during rollout: whether the 92 unfunded 2026 lines
should be set to `WARN` individually or whether the organisation wants a standing policy for lines
the plan never funded. That is a configuration decision, not a design one, and the screens this
change delivers are what makes either answer executable.
