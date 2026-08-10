## Why

Today a budget is checked exactly where it is posted: `reserve` locks one `budget` row,
sums that row's `budget_txn`, and blocks on that row alone. That hardwires the control
point to the leaf, so an organisation that plans at line level but manages money at
category or department level has no way to express it. The only two outcomes available
are "block every line at its own amount" or "warn and let everything through" —
neither of which is how the money is actually governed.

The cost of the missing middle is not theoretical. A department can hold plenty of
unspent budget while one line inside it is exhausted, and the submitter is blocked
anyway; the usual human response is to charge the spend to a different line that still
has room, which destroys the reporting the budget existed to produce. Standard practice
(SAP availability control, Oracle control budgets) separates the two concerns: post at
the leaf, check at a configurable node.

Doing this now rather than later matters because it decides the shape of everything
downstream — period control, budget versions, and the eventual balance projection all
hang off *where the check happens and what is locked while it happens*.

## What Changes

- **New `budget_control_point` table.** A control point names an `account` node and a
  `department` node for a fiscal year. A budget is governed by every active control
  point whose account node is an ancestor-or-self of the budget's account AND whose
  department node is an ancestor-or-self of the budget's department. Both trees already
  exist (`account.parent_id`, `department.parent_dept_id`); no new hierarchy is invented.
- **Availability is checked at the control point, not at the budget row.** Lines are
  grouped by budget (as today), then folded up to every governing control point, and the
  *summed* request is checked once per control point. A document touching three leaves
  under one control point is checked against their total, not three times individually.
- **All governing control points must pass, not just the nearest.** Otherwise adding a
  narrower control point would silently lift a wider ceiling.
- **BREAKING (internal): `reserve` no longer locks the `budget` row.** The serialization
  point moves to the control point row, which is locked `FOR UPDATE` in sorted id order.
  `reserve` never mutates `budget`, so the old lock has no remaining job, and keeping two
  lock classes would introduce a deadlock cycle that does not exist today.
- **Every ACTIVE budget MUST be covered by at least one active control point.** An
  uncovered budget has nothing to lock and nothing to check — it would be silently
  unlimited. Enforced at budget creation and at control-point deactivation.
- **`executeTransfer` moves its availability check from the source budget to the source
  budget's governing control points**, and locks both endpoints' control points in the
  same sorted order as `reserve` so a transfer racing a reservation cannot over-commit.
- **Tolerance ladder replaces the binary policy.** A control point carries an ordered
  list of thresholds with actions `WARN` and `BLOCK`. `HARD_STOP` maps to
  `[{at: 100, BLOCK}]` and `SOFT_WARNING` to `[{at: 100, WARN}]`, so existing behaviour is
  expressible exactly. An `ESCALATE` action (inject an extra approval step) is
  deliberately **out of scope** — it belongs with the approval-workflow change.
- **`cap_amount` column is added but always NULL in this change.** NULL means the control
  point's ceiling is the rollup of the budgets it governs. A non-NULL ceiling
  (a department cap deliberately smaller than the sum of its lines) needs a parent/child
  reconciliation rule and is a separate change; reserving the column now avoids a second
  migration.
- **Over-budget errors name the control point that blocked, not the budget line.** The
  submitter chose a line that still had room; without this the refusal is unexplainable.
- **Seed makes day one a no-op.** Every existing budget gets one control point at its own
  account and department, so each subtree has exactly one member and every check,
  refusal, and existing test behaves identically. Moving control upward is then a
  configuration change, not a deployment.

Deliberately **not** in this change: the `budget_balance` projection. At current volume
(~30 budget transactions/day) the live subtree sum is not a bottleneck, and because the
control point row is already the lock target, the projection can be slotted in later
behind a single balance-read seam without touching the locking protocol. `design.md`
records that seam and the thresholds that should trigger building it.

## Capabilities

### New Capabilities

None. Control points extend how `budget-control` decides sufficiency; they do not
introduce a separate capability.

### Modified Capabilities

- `budget-control`: availability is evaluated at a configurable control point instead of
  the posting budget row; the lock target moves to the control point; the binary
  over-limit policy becomes a tolerance ladder; a coverage invariant is added; transfer
  checks and locks at control points; over-budget errors identify the blocking control
  point.
- `web-budgets`: the budget detail must show the control points governing a budget and
  the available amount at each, so a user can see why a line with room was refused.

## Impact

**Data model** — `erp_approval_system.dbml` gains `budget_control_point`
(`id`, `company_id`, `fiscal_year_id`, `account_node_id`, `department_node_id`,
`cap_amount` nullable, `tolerance_json`, `is_active`, unique on
`(company_id, fiscal_year_id, account_node_id, department_node_id)`). `budget.control_policy`
is superseded by the control point's tolerance ladder; it is migrated, then retained
read-only for one release rather than dropped in the same migration.

**Backend** — `budget-ledger.service.ts` (`reserveIn`, `executeTransfer`,
`executeAdjustment`), `budget-balance.service.ts` (new balance-at-control-point read,
existing per-budget reads unchanged), `budget.service.ts` and `budget.controller.ts`
(coverage validation on create; control-point CRUD), a new coverage resolver over the
account and department trees (recursive CTE, cached per request).

**Frontend** — `web-budgets` budget detail gains a governing-control-points panel; the
over-budget error surface must render the control point name it is given.

**Permissions** — control-point administration reuses `BUDGET_MANAGE`; reading a control
point's balance reuses `BUDGET_VIEW`. No new permission codes.

**Invariants** — Invariant 2 and 3 are untouched: `budget_txn` stays append-only and every
balance, at leaf or at node, is still summed from it; only the *set of rows summed* widens.
Invariant 1 holds because a control point is company-scoped and the coverage resolver
never crosses companies. Invariant 4, 5, 6 and 8 are unaffected — posting, settlement,
release and rate locking do not change. Invariant 7 is reinforced: the concurrency rule
still holds, with the control point as the row read `FOR UPDATE`.

**Risk** — the deadlock surface is the main one. Two lock classes are collapsed to one and
every writer that can reduce availability must acquire control-point locks in the same
sorted order; the change adds concurrency tests for cross-leaf, cross-node, and
transfer-versus-reserve races, including the transfer-versus-reserve race that is
untested today.
