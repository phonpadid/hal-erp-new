## 1. Data model and migration

- [x] 1.1 Add `budget_control_point` to `erp_approval_system.dbml`: `id`, `company_id`, `fiscal_year_id`, `account_node_id`, `department_node_id`, `cap_amount` (nullable decimal(15,2)), `tolerance_json`, `is_active`, with `unique(company_id, fiscal_year_id, account_node_id, department_node_id)` and an index on `(company_id, fiscal_year_id)`; add `Ref` lines to `company`, `fiscal_year`, `account` and `department`
- [x] 1.2 Add a table Note recording that a control point is a checkpoint, not a posting target — `account.is_postable` does not restrict where it may sit — and that `cap_amount` NULL means the ceiling is the rollup of governed budgets
- [x] 1.3 Create the MikroORM `BudgetControlPoint` entity in `back/src/modules/budget/budget.entities.ts`, money and `cap_amount` mapped as `decimal` carried as string
- [x] 1.4 Generate the migration for the new table; leave `budget.control_policy` in place, unread, for one release
- [x] 1.5 Write the seed step: one control point per existing `budget`, `account_node_id` = the budget's `account_id`, `department_node_id` = its `department_id`, `cap_amount` NULL, `tolerance_json` translated from `control_policy` (`HARD_STOP → [{at:100,action:BLOCK}]`, `SOFT_WARNING → [{at:100,action:WARN}]`)
- [x] 1.6 Register `BudgetControlPoint` in `budget-control.module.ts`; confirm it is NOT added to `APPEND_ONLY` in `ledger-guard.subscriber.ts` — it is configuration, not a ledger

## 2. Coverage resolver

- [x] 2.1 Implement `resolveControlPoints(budgetIds)` returning `budgetId → [controlPointId...]`: a recursive CTE walking `account.parent_id` and `department.parent_dept_id`, filtered to `is_active` control points in the same `company_id` and `fiscal_year_id` (invariant 1)
- [x] 2.2 Memoise the resolver per request so one submit resolves each budget once
- [x] 2.3 Unit test: a control point matching both trees governs; matching only one tree does not; a control point in another company never governs
- [x] 2.4 Unit test: a control point on a non-postable `account` node governs normally

## 3. Balance at a control point

- [x] 3.1 Add `balanceAt(controlPointId, em?)` to `budget-balance.service.ts`: sum `budget.amount_total` over the governed budgets plus that set's `budget_txn` using the existing invariant-3 formula — ACTUAL never subtracted
- [x] 3.2 Add a breakdown variant at control-point level reusing the same terms, so `available` can never diverge from the sum (mirror the existing note tying `availableBalance` and `breakdown` together)
- [x] 3.3 Keep the existing per-budget `availableBalance`, `availableFor` and `breakdown` reads unchanged — they remain the budget detail's own figures
- [x] 3.4 Unit test: for a control point governing exactly one budget, `balanceAt` equals `availableBalance` for that budget across every txn type
- [x] 3.5 Unit test: ACTUAL is not subtracted at control-point level either

## 4. Tolerance ladder

- [x] 4.1 Define the ladder type and a Zod/class-validator schema for `tolerance_json` entries `{at: number, action: 'WARN' | 'BLOCK'}`, rejecting empty or unparseable ladders at write time
- [x] 4.2 Implement ladder evaluation: every entry whose `at` is met or exceeded by `(used + requested) / ceiling` applies; a matched `BLOCK` rejects, matched `WARN`s alone allow and return warnings
- [x] 4.3 Reject a non-null `cap_amount` on create and update
- [x] 4.4 Unit test the ladder: block at 100, warn at 100, warn at 80 then block at 100 (both the warning and the blocking case), empty ladder rejected

## 5. Reservation path

- [x] 5.1 In `reserveIn`, after grouping lines by `budgetId` and after the ancestor-hold exclusion, fold amounts up to each governing control point (`byCp`), so an excluded budget contributes nothing to any control point's requested total
- [x] 5.2 Lock every control point in `byCp` with `lockForUpdate(BudgetControlPoint, id)` in ascending id order, all of them before any check
- [x] 5.3 Remove the `lockForUpdate(Budget, ...)` from `reserveIn`; leave posting (`insertTxn` per `budgetId`) untouched
- [x] 5.4 Move `budgetsHeldByAncestors` off budget-row locks onto the governing control points, in the same sorted order — the protection it provides (a concurrent `settle` cannot release between the check and the insert) must survive the move, not merely be relocated
- [x] 5.5 Check each control point via `balanceAt` and the ladder; on BLOCK throw `BUDGET_EXCEEDED` carrying the blocking control point's id, its identifying nodes, and its available amount
- [x] 5.6 Keep the whole sequence inside the caller's existing `em.transactional(...)` from `document-submit.service.ts` — open no new transaction

## 6. Transfer and adjustment paths

- [x] 6.1 In `executeTransfer`, resolve the governing control points of both endpoints, lock their union in ascending id order using the same comparator as `reserveIn`
- [x] 6.2 Move the transfer's sufficiency check from `availableBalance(fromBudgetId)` to the source's governing control points and the ladder
- [x] 6.3 In `executeAdjustment`, lock the governing control points of the adjusted budget in the same order; keep the existing behaviour of not checking availability on ADJUST_DECREASE
- [x] 6.4 Move `settle` and `releaseAll` onto control-point locks too — they cannot over-commit, but they must be SERIALIZED against the ancestor-hold check, and after 5.3 the control point is the only row where the two can meet
- [x] 6.5 Assert the single-lock-class rule holds: no `lockForUpdate(..., Budget, ...)` remains anywhere in the budget module, and record the rule where a future writer will read it

## 7. Coverage invariant

- [x] 7.1 On budget creation, within the same transaction as the budget insert, create a self-scoped control point when no active one already governs the new budget
- [x] 7.2 Reject control-point deactivation or deletion that would leave any `ACTIVE` budget uncovered, with a 400 naming the budget
- [x] 7.3 Unit test: creating an uncovered budget creates a control point; creating an already-covered budget creates none
- [x] 7.4 Unit test: deactivating the last covering control point is refused; deactivating a redundant one succeeds

## 8. API surface

- [x] 8.1 Add control-point CRUD DTOs with class-validator, `ParseUUIDPipe` on UUID params, and `cap_amount` rejected when non-null
- [x] 8.2 Add controller routes gated by `BUDGET_MANAGE` (create, update, deactivate, list) and `BUDGET_VIEW` (balance at a control point), all company-scoped; introduce no new permission code
- [x] 8.3 Extend the `BUDGET_EXCEEDED` error payload with the blocking control point's id, nodes and available amount, keeping the stable error code unchanged
- [x] 8.4 Test: control-point administration is rejected with 403 without `BUDGET_MANAGE`; the balance read is rejected without `BUDGET_VIEW`; both reads are company-scoped

## 9. Concurrency tests

- [x] 9.1 Two concurrent reservations against **different budgets** governed by the same control point, jointly exceeding it — exactly one succeeds
- [x] 9.2 One document with three lines charging three budgets under one control point, jointly exceeding it — the submission is refused
- [x] 9.3 Two documents touching control points {A,B} and {B,A} concurrently — neither deadlocks
- [x] 9.4 Transfers X→Y and Y→X concurrently — neither deadlocks
- [x] 9.5 A reservation racing a transfer that draws from the same control point — jointly they cannot over-draw (a gap that exists today and is untested)
- [x] 9.6 Two concurrent reservations against the same budget, as today — still exactly one succeeds

## 10. Behaviour-preserving verification

- [x] 10.1 Run the existing `budget-*.spec.ts`, `document-engine*.spec.ts`, `chain-reservation.spec.ts` and `line-item-budget-enforcement.spec.ts` suites **without modification**; treat any diff as a regression
- [x] 10.2 Add a test asserting that with a seeded one-budget control point, accepted and refused amounts are identical to per-budget checking
- [x] 10.3 Verify no `budget_txn` write path was added or removed — posting is unchanged (invariants 2 and 4)

## 11. Web

- [x] 11.1 Add a governing-control-points panel to the budget detail: account node, department node and available amount per control point, formatted to the base currency's `decimal_places`, never a JS number
- [x] 11.2 Mark the control point with the lowest available as the one that will refuse first
- [x] 11.3 Gate the panel on `BUDGET_VIEW` from the active-company context, mirroring the server rule
- [x] 11.4 Surface the blocking control point and its available amount in the over-budget error message
- [x] 11.5 Style with PrimeUI theme tokens only, so light and dark both work

## 12. Documentation

- [x] 12.1 Record in `design.md` Open Questions whichever answers review settles (control points on postable nodes, ladder ordering validation, whether WARN notifies)
- [x] 12.2 Note in the budget module where the `balanceAt` seam sits and the thresholds that should trigger building the `budget_balance` projection, so the next person does not have to rediscover it
