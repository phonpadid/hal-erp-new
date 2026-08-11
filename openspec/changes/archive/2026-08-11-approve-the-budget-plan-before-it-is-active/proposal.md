## Why

Setting a budget is the largest financial decision the budget module makes, and it is the only
one nobody has to approve. `POST /budgets` takes `BUDGET_MANAGE` and the budget is spendable the
moment it returns — while moving one kip between two existing budgets requires a document, a
workflow, and every approver on the route. The control is inverted: the ceiling itself can be set
by one person with no second signature and no paper trail, and then only *changes* to it are
governed.

The gap is not theoretical. `budget_movement` already proves the shape works — adjustment and
transfer both create a document, wait for full approval, and let `PostActionService` apply the
effect. Budget creation simply never got the same treatment.

It also does not fit how the figures are actually produced. A year's budget is authored as one
sheet covering every department and approved once, not line by line: approving 100 lines as 100
independent documents would leave the fiscal year half-active for as long as the approvals take,
with spending documents hitting budgets that exist but are not yet in force.

## What Changes

- **BREAKING** `POST /budgets` no longer produces a spendable budget. It creates a `budget` row
  with `status` `DRAFT`, which cannot be spent against and is not governed by a control point yet.
  Callers that expected an immediately-`ACTIVE` budget must now go through a plan.
- A **budget plan** is a document carrying one or more proposed budgets for a fiscal year. It
  reuses `budget_movement` — one row per proposed budget, `movement_type` `ACTIVATE_BUDGET`,
  `to_budget_id` pointing at the `DRAFT` budget — so no new table is introduced. Its document type
  sets `requires_budget = false`: a plan proposes budget, it does not consume any.
- A new `post_action` `ACTIVATE_BUDGET` activates the whole plan atomically on full approval: every
  `DRAFT` budget on the plan becomes `ACTIVE`, every one of them is given control-point coverage,
  and the coverage invariant is verified before the transaction commits. Either the whole year's
  plan takes effect or none of it does.
- Rejecting or cancelling a plan sets its budgets to `REJECTED` rather than deleting them, so the
  record of what was proposed and turned down survives.
- **BREAKING** the `budget` uniqueness constraint on (`fiscal_year`, `department`, `gl_account`)
  becomes partial — it applies only to rows whose `status` is not `REJECTED`. A `DRAFT` row still
  holds the slot, so two plans cannot propose the same line at once; a rejected one releases it, so
  a line that was turned down can be proposed again.
- **BREAKING** budget creation no longer accepts a tolerance ladder. The ladder belongs to a
  control point that only exists once the plan is approved, and there is nowhere to hold a proposed
  ladder in the meantime that would not be a column meaningless the moment it is used. Activation
  mints coverage that blocks at its ceiling — the same default creation applies today when no
  ladder is given — and ladders are configured on the control-point screens, which is already the
  only place they can be changed after the fact.
- Budgets that are already `ACTIVE` when this ships are grandfathered: the migration records that
  rows predating it carry no approving document, deliberately. Back-dating documents for them would
  manufacture approvals that never happened.
- The budget list and detail screens distinguish `DRAFT`, `ACTIVE` and `REJECTED`, and the create
  screen authors a plan instead of writing a budget directly.

Deliberately **out of scope**, and stated so the omissions are choices rather than oversights:

- **Tolerance ladders are not authored on the plan.** Activation mints coverage the same way
  creation does today. The hole being closed is "a ceiling set with nobody's approval"; how
  strictly that ceiling is enforced is already configurable on the control-point screens, and
  pulling ladder authoring into the plan would roughly double this change without closing any
  further hole. The consequence is that when several lines in one plan would mint the same control
  point, the first one processed decides its ladder — activation SHALL therefore process lines in a
  deterministic order so the outcome is at least reproducible.
- **Auditing changes to control points.** `budget_control_point` records nothing about who changed
  a ladder or when. That is a real gap, but it is a different one — this change is about needing
  permission beforehand, that one is about knowing afterwards — and it belongs in its own change.
- **Multi-line plan authoring UI and spreadsheet import.** The data model is 1..N from the start so
  these need no further schema work, but this change ships the single-line author flow.

## Capabilities

### New Capabilities

None. Budget plans are budget administration, and `budget-control` already owns the other two
document-mediated budget changes (`Adjustment Document Creation`, `Transfer Request Intake`).

### Modified Capabilities

- `budget-control`: budget creation yields a `DRAFT` budget instead of an `ACTIVE` one; a new
  requirement covers plan intake, atomic activation, and rejection; `Budget Administration and
  Derived-Balance Query` and `Every Active Budget Is Covered by a Control Point` change to move
  coverage from creation to activation; the uniqueness rule becomes status-aware.
- `approval-workflow`: `Post-Action Execution on Full Approval` gains the `ACTIVATE_BUDGET` action —
  the first post-action that reads *many* `budget_movement` rows for one document rather than
  exactly one; `Reject Returns and Releases` gains the plan's status flip.
- `web-budgets`: the create form authors a plan and reports its approval state; the list and detail
  screens show non-`ACTIVE` budgets as such.

## Impact

**Backend**

- `back/src/modules/budget/budget.service.ts` — `create` writes `DRAFT` and no longer calls
  `ensureCovered`; `ensureCovered` moves to activation.
- `back/src/modules/budget/budget-plan.service.ts` (new) — plan intake, submit, and the activation
  routine, modelled on `budget-adjustment.service.ts`.
- `back/src/modules/approval/post-action.service.ts` — new `ACTIVATE_BUDGET` case in the `switch`
  at line 60. `movementOf` (`findOne`) is untouched; the new case reads all movements for the
  document.
- Rejection and cancellation must also mark a plan's budgets `REJECTED`, alongside the existing
  auto-release. Budget release itself is unaffected: a plan reserves nothing.
- `back/src/modules/budget/dto/budget.dto.ts` — `tolerance` removed from `CreateBudgetDto`.
- `Migration20260812000000` — partial unique index replacing
  `budget_fiscal_year_id_department_id_gl_account_unique` (`Migration20260617000000.ts:32`).
- `Migration20260812000001` — the plan `document_type`, form template and routing for companies
  that already exist, borrowing each company's routing from the budget document type it already
  approves. `seed-data.ts` covers a database seeded from scratch; the seed never runs against an
  existing one, and a company without this type can draft budgets but activate none.
- `back/src/seed/seed-data.ts` — the seeded budget is created `ACTIVE` at the service layer, as a
  grandfathered row, not through a plan.

**Frontend**

- `front-end/src/views/budgets/BudgetCreateView.vue`, `BudgetListView.vue`, the budget detail view,
  `front-end/src/stores/budgets.ts`, and the shared Zod schemas in `shared/src/index.ts`.

**Invariants**

- Invariant 2 (append-only ledgers) is untouched: activation writes no `budget_txn`. A budget's
  opening figure is the `amount_total` column, not a transaction (invariant 3), so activating a
  budget moves no money.
- Invariant 4 (reserve → actual → release) is untouched: a plan reserves nothing, so there is
  nothing to release when one is rejected.
- Invariant 7 (configuration over code) is respected: activation is driven by `post_action`, like
  every other approval effect, not by a hardcoded document type code.
- The coverage invariant ("every `ACTIVE` budget is governed by at least one active control point")
  keeps its wording exactly — `DRAFT` and `REJECTED` fall outside it by construction.

**Risk**

The activation transaction is the only new place where many budgets and many control points are
written at once. It must take the same control-point lock ordering the ledger already uses, or a
plan activating while documents are spending can deadlock.
