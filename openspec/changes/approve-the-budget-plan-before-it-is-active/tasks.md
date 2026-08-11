## 1. Schema and seed

- [x] 1.1 Migration: drop `budget_fiscal_year_id_department_id_gl_account_unique` and create the
      partial unique index on (`fiscal_year_id`, `department_id`, `gl_account`)
      `where status <> 'REJECTED'`. Comment that existing rows are unaffected because no `REJECTED`
      row exists yet, and that the down migration fails once any does (design, Migration Plan).
- [x] 1.2 The budget-plan `document_type` per company — `post_action` `ACTIVATE_BUDGET`,
      `requires_budget` false, `requires_quota` false, `requires_vendor` false, `requires_item`
      false, `requires_payee` false — with its `form_template` and `dept_doc_type` mappings, in TWO
      places for two audiences. `seed-data.ts` covers a database seeded from scratch, following the
      adjustment/transfer type seeding already there. `Migration20260812000001` covers databases
      that already exist, which the seed never runs against: it BORROWS each company's routing from
      the budget document type that company already approves (TRANSFER, else ADJUST_INCREASE, else
      ADJUST_DECREASE — a fixed order so two replicas agree) rather than inventing a workflow, and
      skips a company with no budget type at all. Without it an upgraded database can draft budgets
      but never activate any, which is a harder failure than the other budget types have: missing
      `BUDGET_TRANSFER` costs you transfers, missing `BUDGET_PLAN` costs you the module.
- [x] 1.3 `budget.entities.ts`: relax the `@Unique` decorator to match the partial index so
      MikroORM's schema diff stays clean, and document the `DRAFT` / `ACTIVE` / `REJECTED` values
      on `Budget.status`.
- [x] 1.4 `seed/seed-data.ts`: create the seeded budget `ACTIVE` at the service layer as a
      grandfathered row (design D7). Do not seed a fictional approved plan. Its existing control
      point upsert stays.

## 2. Budget creation becomes a proposal

- [x] 2.1 `budget.service.ts`: `create` writes `status` `DRAFT` and no longer calls
      `ensureCovered`. Keep the GL-account resolution and `account_id` recording unchanged.
- [x] 2.2 Move `ensureCovered` out of `BudgetService` into the activation routine (task 3.2). Leave
      a comment at the old site pointing to where coverage is now established and why.
- [x] 2.3 `dto/budget.dto.ts`: remove `tolerance` from `CreateBudgetDto`. With
      `forbidNonWhitelisted` this makes a request carrying one a 400 rather than a silent drop —
      the same treatment `controlPolicy` already gets.
- [x] 2.4 `shared/src/index.ts`: drop `tolerance` from the budget create schema so client and server
      do not drift.

## 3. Budget plans

- [x] 3.1 `budget-plan.service.ts` (new): plan intake, modelled on `budget-adjustment.service.ts` —
      resolve the type by `post_action` within the active company, check `dept_doc_type`, issue the
      number, create the `Document` plus one `BudgetMovement` per line with `movement_type`
      `ACTIVATE_BUDGET` and `to_budget_id` set. Reject a line referencing a budget that is not
      `DRAFT` or belongs to another company, and a line whose department is outside the routing
      department's subtree (design D9).
- [x] 3.2 `budget-plan.service.ts`: the activation routine, in one `em.transactional`. Resolve
      coverage for **all** the plan's budgets up front (not per line — the coverage resolver
      memoises per EntityManager, so a loop would read its own stale cache and mint duplicate
      control points that fail on the unique constraint at flush; design D5). Lock the existing
      governing `budget_control_point` rows `FOR UPDATE` in ascending id order, the same total
      order `BudgetLedgerService.lockControlPoints` uses. Then flip each budget to `ACTIVE`, mint
      the deduplicated set of missing control points, and verify coverage for every budget before
      committing. Writes no `budget_txn`. Refuse activation when the plan's `fiscal_year.status` is
      not `OPEN` (design D10).
- [x] 3.3 `budget-plan.service.ts`: process lines in the deterministic order — department tree
      depth, then `dept_code`, then `gl_account` — so the same plan content always mints the same
      control points with the same ladders.
- [x] 3.4 `budget-plan.service.ts`: rejection/cancellation sets the plan's budgets from `DRAFT` to
      `REJECTED` without deleting them.
- [x] 3.5 `dto/budget-plan.dto.ts` (new): `CreateBudgetPlanDto` with a validated non-empty line
      array. Money as string, never a JS number.

## 4. Wiring into the approval engine

- [x] 4.1 `post-action.service.ts`: add the `ACTIVATE_BUDGET` case to the `switch` at line 60,
      calling the activation routine. Leave `movementOf` (`findOne`) untouched — it belongs to the
      transfer and adjust cases only.
- [x] 4.2 Hook the plan's status flip into the existing reject/cancel path, alongside the budget and
      quota release. Nothing is released for a plan; assert that rather than assuming it.
- [x] 4.3 `budget.controller.ts`: `POST budgets/plans`, `GET budgets/plans/:id` under
      `BUDGET_MANAGE` / `BUDGET_VIEW`. `ParseUUIDPipe` on the id param. Declare the routes before
      any `:id` route that could capture them, as the control-point routes already do.
- [x] 4.4 Register the new service in `budget-control.module.ts`.

## 5. Frontend

- [x] 5.1 `stores/budgets.ts`: a group for budgets whose `status` is not `ACTIVE`, distinct from
      `UNGOVERNED_GROUP`, carrying no ceiling or available figure.
- [x] 5.2 `BudgetListView.vue`: render that group labelled by status, and keep the
      configuration-fault group for `ACTIVE` budgets only.
- [x] 5.3 `BudgetCreateView.vue`: save posts a plan and routes to the plan document. State on the
      form that saving proposes a budget for approval rather than putting it in force.
- [x] 5.4 Budget detail: for a `DRAFT` or `REJECTED` budget, name and link the proposing plan with
      its approval state, and hide the Adjust and Transfer affordances.
- [x] 5.5 i18n: en/la parity for every new label. Verify each key exists — a missing key renders as
      the raw key rather than failing.
- [x] 5.6 Theme tokens only, no hardcoded colors, checked in both light and dark. The three additions
      use `text-muted-color`, `text-primary` and PrimeVue `Message` severities — no hex, no `rgb()`,
      so both themes follow from the tokens rather than from a second set of values.

## 6. Tests

- [x] 6.1 Creation: a created budget is `DRAFT` and mints no control point; a tolerance ladder on
      create is a 400.
- [x] 6.2 Uniqueness: a `DRAFT` row blocks a second budget on the same three dimensions; a
      `REJECTED` row does not.
- [x] 6.3 Activation: every budget on a plan becomes `ACTIVE` with coverage; a failure on one line
      leaves none `ACTIVE`; no `budget_txn` row is written.
- [x] 6.4 Activation dedupe: a plan with two lines resolving to the same account node and department
      node mints exactly one control point. This is the test that pins the memoisation hazard
      (design D5) — it fails with a unique-constraint error if the routine loops `ensureCovered`.
- [x] 6.5 Determinism: activating the same plan content twice mints the same control points.
- [x] 6.6 **Concurrency**: activation racing a reservation against a shared control point. Both
      complete, neither deadlocks, and the reservation is decided against either the pre- or
      post-activation ceiling — never a partly-activated plan.
- [x] 6.7 Rejection: the plan's budgets become `REJECTED`, the rows survive, nothing is released,
      and the freed dimension slot accepts a new proposal.
- [x] 6.8 Coverage invariant: a `DRAFT` budget is owed no coverage, and a control point governing
      only `DRAFT` budgets can be deactivated.
- [x] 6.9 Company scope: a plan cannot reference a budget of another company; plan reads are
      company-scoped. Routing subtree: a line outside the routing department's subtree is a 400, a
      line for a descendant is accepted.
- [x] 6.10 Frontend: `DRAFT` budgets group separately from the configuration-fault group; the create
      form posts a plan; Adjust and Transfer are absent on a non-`ACTIVE` budget.
- [x] 6.11 Existing suites: 1316 backend tests and 705 frontend tests pass. Six assertions changed,
      all of them behaviour this change deliberately alters (creation minting a control point, and
      a tolerance ladder being accepted on create); every other assertion in the budget, document
      and approval suites stands unedited, which is what shows the rest of the behaviour is
      preserved. Fixtures changed only mechanically (constructor arity, and `attachCoverage` still
      producing grandfathered `ACTIVE` rows).
- [x] 6.12 Closed year: a plan whose `fiscal_year.status` is not `OPEN` does not activate and the
      terminal transition rolls back.
