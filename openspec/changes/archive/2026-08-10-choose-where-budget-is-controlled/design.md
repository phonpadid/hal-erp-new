## Context

`BudgetLedgerService.reserveIn` does three things at one address: it locks the `budget`
row, sums that row's `budget_txn` to an available balance, and inserts the `RESERVE`.
Because lock, check and post all land on the same row, the code is short and provably
correct — the row that gates over-commit is the row that is held.

Moving control to a configurable node breaks that coincidence apart:

```
  today                              with control points
  ─────                              ───────────────────
  lock   → budget row                lock   → control point row
  check  → that row's txns           check  → every budget in the subtree
  post   → that row                  post   → the leaf budget (unchanged)
```

Everything difficult in this change follows from that one split. Both hierarchies the
resolver walks already exist and are already enforced elsewhere: `account.parent_id` with
`is_postable` (budgets already resolve only to active postable accounts,
`budget-control/spec.md` "Budget Administration") and `department.parent_dept_id`.

Constraints inherited from the codebase, not chosen here:
- `budget_txn` is append-only, guarded twice (`AppendOnlyRepository` and
  `LedgerGuardSubscriber`), so nothing may be corrected by update.
- Balances are always derived (invariant 3). The `ACTUAL`-is-not-a-deduction rule is
  written into `budget-balance.service.ts` in two places that must never diverge.
- The house concurrency idiom is `inTransaction` + `lockForUpdate`
  (`common/uow/unit-of-work.ts`). Raw SQL locking would be a new primitive.
- The codebase already distinguishes ledgers from projections and writes down why
  (`common/ledger/ledger-guard.subscriber.ts`): `stock_balance` and `attendance_day` are
  projections, overwritable and rebuildable, and `stock_balance` is explicitly "the row
  you SELECT FOR UPDATE before checking availability".

Observed volume from the customer's current spreadsheet: ~5,400 expense transactions in
six months, about 30/day. That number decides several choices below.

## Goals / Non-Goals

**Goals:**

- Availability is decided at a configurable node of the account × department trees, while
  posting stays at the leaf budget.
- A document that charges several leaves under one control point is checked against their
  combined amount, once.
- Concurrent submissions charging *different* leaves under the *same* control point cannot
  both pass when their sum would exceed it.
- No deadlock is introduced, including between `reserve` and `executeTransfer`.
- Day-one behaviour is byte-identical: seeded control points reproduce today's per-budget
  checks, and every existing test passes unchanged.
- The balance read is a single seam, so a projection can replace the live sum later
  without touching the locking protocol.

**Non-Goals:**

- The `budget_balance` projection. Designed for below, not built.
- `cap_amount` semantics. The column ships NULL-only; a node ceiling that differs from the
  rollup needs a reconciliation rule and is a separate change.
- `ESCALATE` as a tolerance action. Injecting an approval step belongs to
  `approval-workflow`.
- Period control, budget versions, budget preparation workflow, year-end carry-forward.
  All are separate changes; this one only makes sure their shape is not foreclosed.
- Location and project dimensions. Control points are defined over account × department
  only.

## Decisions

### D1 — The control point row is the lock target

**Chosen:** `lockForUpdate(BudgetControlPoint, id)` on every governing control point,
acquired in sorted-id order, before any check.

The row exists anyway to hold configuration, so this costs no new table, no new primitive,
and reuses the exact idiom the rest of the codebase uses.

*Alternatives considered:*

- **Lock every budget in the subtree.** Correct, but locks hundreds of rows per submit and
  has a real hole: a budget inserted into the subtree by a concurrent transaction is not
  covered by a lock set computed from a prior read.
- **`pg_advisory_xact_lock(hashtext(cp_id))`.** Cheap and correct, but introduces raw SQL
  locking as a second concurrency primitive, and an advisory lock has no row to inspect
  when diagnosing a stall.

### D2 — The control point is the ONLY lock class; the `budget` row is never locked

**Chosen:** every operation that writes `budget_txn` locks the governing control points, in
sorted id order, and no operation locks a `budget` row.

This is wider than "reserve stops locking the budget row", which was the first form of this
decision and was wrong — not incorrect, but incomplete in a way that defeats its own purpose.
`reserveIn` genuinely never mutates `budget`, so its own lock has no job. But the submit path
also calls `budgetsHeldByAncestors`, which locks the same budget rows deliberately, to stop a
concurrent `settle` releasing a hold between the check and the insert; and `settle` and
`releaseAll` lock budget rows for their own read-modify-write. Dropping the lock from
`reserveIn` alone therefore leaves the submit transaction holding both classes anyway, and
dropping it from the ancestor check as well would silently delete a protection that exists —
because `settle` would still be meeting everyone at the budget row that nobody else takes.

Two lock classes admit a cycle that does not exist today:

```
  Tx1: holds Budget X ──── waits ────▶ ControlPoint N
                                            ▲   │ held by
                                            │   ▼
  Tx2: holds ControlPoint N ── waits ──▶ Budget X
```

The standard model answers this the same way. SAP FM/CO and Oracle funds checking keep one
totals record per budget address, and *every* budget-relevant posting updates and locks that
record — commitment, actual, reversal and release alike. Releases are not exempt, precisely
so that no second object can hold part of the truth about one budget address.

So `settle` and `releaseAll` take control-point locks too, even though neither can
over-commit. They take them not to be checked, but to be serialized: the ancestor-hold check
and a concurrent settlement have to meet somewhere, and after this change the only place they
can meet is the control point.

This is safe **only** because of D3. Without guaranteed coverage, a budget with no control
point would be locked by nothing and checked by nothing.

*Alternative considered:* keep both lock classes with a fixed global order (all control
points sorted, then all budgets sorted). Equally deadlock-free and it leaves `settle` and
`releaseAll` untouched. Rejected because "equally safe" holds only while every future writer
remembers an ordering rule that spans two classes — an invariant carried by convention rather
than by structure. One class, one comparator, is a property the code can't drift away from.

*Cost accepted:* settlement and release now serialize on the control point, so at a coarse
control point they queue behind reservations in the same subtree. At ~30 budget transactions
a day this is not measurable; if it ever is, the projection (D5) shortens the held-lock
window without changing what is locked.

### D3 — Coverage is an invariant, not a convention

Every `ACTIVE` budget MUST be governed by at least one active control point. Enforced in
three places, because any single one of them can be bypassed:

1. **Seed** creates one control point per existing budget at its own account and
   department.
2. **Budget creation** creates a self-scoped control point when no active one already
   governs the new budget.
3. **Control-point deactivation/deletion** is rejected when it would leave any `ACTIVE`
   budget uncovered.

Rule 3 is the one that matters. Without it, one configuration edit silently disables
budget control across a company — the failure is invisible because nothing errors, spending
simply stops being checked.

### D4 — Every governing control point must pass

The governing set for a budget is the cross product of ancestor-or-self on both trees,
filtered to active rows:

```
  budget = (account 6110, department D3)

    6110 ─ 611 ─ 61 ─ 6            D3 ─ D1 ─ ROOT
     └───────┬────────┘             └────┬─────┘
             └────────── × ──────────────┘   → filter is_active
```

All of them are checked. The alternative — check only the most specific — makes adding a
narrower control point a way to escape a wider ceiling, which is a control defect rather
than a convenience.

Consequence: one reservation may check two or three points, and the refusal must say which
one blocked (D6).

### D5 — Live subtree sum now, projection later, one seam

`balanceAt(controlPointId)` is the only place the widened balance is computed. Today it
sums `budget.amount_total` over the subtree plus that subtree's `budget_txn` using the
invariant-3 formula, unchanged in every term.

At ~30 transactions/day this is not a bottleneck, and the projection is therefore not built
here. Because D1 already locks the control point row, adding the projection later changes
only the body of `balanceAt` and adds a write to the post step — the protocol, the lock
order and the tests are untouched.

When it is time (any of: p95 submit-with-budget > ~300ms; largest subtree > ~500 budgets;
`budget_txn` > ~500k rows; a bulk historical import), the shape is:

```
  budget_balance                     -- projection of budget_txn + budget.amount_total
    control_point_id  [unique]       -- same row already locked in step 4
    company_id
    amount_base, adjust_increase, adjust_decrease,
    transfer_in, transfer_out, reserved, released, actual
    updated_at
```

with the same rules `stock_balance` already carries: written in the same transaction as the
ledger insert (never a background job), rebuildable from the ledger to the identical value,
covered by an equivalence test against the live sum, and rebuilt — not updated — whenever
control-point configuration moves.

*Alternative considered:* build the projection now. Rejected: it is the larger half of the
work, it is not yet needed, and deferring it costs nothing because the lock target is
already right.

### D6 — Refusals name the control point

Today: `Over budget: 60,000 requested, 50,000 available on budget <id>`, and the user can
see that budget. With node control the user picks a line that still has room and is
refused by an ancestor. `BUDGET_EXCEEDED` therefore carries the blocking control point's
identity and its available amount, and `web-budgets` shows the governing points on the
budget detail. Without this the system is correct and unusable.

### D7 — Tolerance ladder, without `ESCALATE`

`tolerance_json` is an ordered list of `{at: <percent>, action: WARN | BLOCK}` evaluated
against `(used + requested) / ceiling`. The highest matching threshold wins; `BLOCK`
anywhere in the matched set blocks.

Migration is exact, not approximate: `HARD_STOP → [{at: 100, action: BLOCK}]`,
`SOFT_WARNING → [{at: 100, action: WARN}]`. `ESCALATE` is omitted deliberately — it must
add a step to a running approval chain, which is `approval-workflow`'s concern and would
double this change's blast radius.

### D8 — `cap_amount` reserved, NULL-only

`cap_amount IS NULL` means the ceiling is the rollup of governed budgets. Non-NULL is
rejected by validation in this change. Adding the column now avoids a second migration on
a table that will already be seeded per budget; enabling it later needs only the
reconciliation rule and its tests.

## Sequence — `reserve` (writes `budget_txn`)

**Transaction boundary:** the whole sequence runs inside the caller's existing
`em.transactional(...)` — `document-submit.service.ts` already opens one and passes `tem`
into `budget.reserve`, so budget, stock and quota still commit or roll back together. No
new transaction is opened.

```
 1. group lines by budgetId                          (existing)
       byBudget: budgetId → Σ baseAmount

 2. resolve governing control points                 (new, cached per request)
       coverage: budgetId → [controlPointId...]
       recursive CTE over account.parent_id × department.parent_dept_id,
       company-scoped (invariant 1)

 3. fold amounts up to each control point            (new)
       byCp: controlPointId → Σ over every governed budget in this document
       a budget appearing under several control points is intentional (D4)

 4. LOCK — all of them, sorted, before any check     (new)
       for cpId of [...byCp.keys()].sort():
           lockForUpdate(BudgetControlPoint, cpId)
       sorted total order over a single lock class ⇒ no deadlock cycle
       no Budget row is locked (D2)

 5. CHECK — per control point                        (new)
       available = balanceAt(cpId)          ← the only projection seam (D5)
       decide via tolerance ladder on (used + requested) / ceiling
       BLOCK → throw BUDGET_EXCEEDED naming cpId and its available (D6)
       WARN  → collect, submit proceeds

 6. POST — at the leaf                               (existing, unchanged)
       for [budgetId, amount] of byBudget:
           insertTxn(budgetId, documentId, RESERVE, amount)
```

Steps 1 and 6 are today's code. Steps 2–5 replace today's per-budget lock-and-check loop
in the middle.

## Sequence — other `budget_txn` writers

Per D2 every writer locks control points and none locks a `budget` row. Locking and checking
are separate columns on purpose: a writer that cannot over-commit still has to be serialized.

| Writer | Reduces available | Locks control points | Checks | Note |
|---|---|---|---|---|
| `reserve` → RESERVE | yes | yes, sorted | yes | above |
| `budgetsHeldByAncestors` (reads only) | no | yes, sorted | no | its whole purpose is to serialize against a concurrent `settle`; after D2 the control point is the only place the two can meet |
| `executeTransfer` → TRANSFER_OUT | yes | yes | yes, at source's control points | check moves off the source budget row |
| `executeTransfer` → TRANSFER_IN | no | yes, in the **same sorted set** as the OUT side | no | destination may sit under different control points |
| `executeAdjustment` → ADJUST_DECREASE | yes | yes | no | approved instruction is authoritative; matches today's behaviour, which locks but does not check |
| `executeAdjustment` → ADJUST_INCREASE | no | yes | no | |
| `settle` → ACTUAL + RELEASE | no | yes | no | converts an existing hold; locked so its read-modify-write of `outstandingReserved` cannot interleave with the ancestor-hold check |
| `releaseAll` → RELEASE | no (returns) | yes | no | same read-modify-write shape as `settle` |

`executeTransfer` currently locks `[from, to].sort()` on `Budget`. It must instead lock the
union of both endpoints' governing control points, sorted, using the same comparator as
`reserve` — otherwise a transfer and a reservation touching one control point can deadlock,
and a transfer racing a reservation can jointly over-draw it. The latter is a gap that
exists today and is untested.

## Risks / Trade-offs

- **A budget ends up with no governing control point → spending on it is silently
  unchecked.** → D3's three enforcement points, plus a test that asserts an uncovered
  `ACTIVE` budget cannot be created and that deactivating the last covering control point
  is refused.
- **Removing the `Budget` lock strands a path that relied on it.** → This already happened
  once, during implementation: `budgetsHeldByAncestors` locks budget rows specifically to
  serialize against `settle`, which the first form of D2 would have quietly deleted. The
  answer is not to exempt paths but to move every one of them to the control point, so no
  writer is left meeting others at a row nobody else takes. The audit that matters before
  merge is a grep for `lockForUpdate(.*Budget` returning nothing in this module.
- **Lock contention at a coarse control point serializes a whole department's submits.** →
  Inherent to node-level control, not to this design. At ~4 submissions/hour it is not
  measurable. It becomes real only if a much higher-volume company is onboarded, at which
  point the projection (D5) shortens the held-lock window.
- **Coverage resolution runs a recursive CTE on every submit.** → Cached per request and
  keyed by budget id; the trees are small and change rarely. If it ever shows up in a
  profile, it is a pure read and can be memoised per fiscal year.
- **The tolerance ladder is a JSON column, so a malformed ladder is a runtime failure.** →
  Validated on write with a schema shared with the DTO; an empty or unparseable ladder is
  rejected at configuration time, never interpreted permissively at check time.
- **Users cannot tell why a line with room was refused.** → D6, and the `web-budgets`
  delta. This is a usability risk that turns into a data-quality risk: an unexplained
  refusal is exactly what pushes people to charge the spend somewhere else.
- **Migration seeds one control point per budget, so the table starts as large as
  `budget`.** → Accepted. It is what makes day one a no-op, and rows are small; collapsing
  them upward is the configuration work that follows.

## Migration Plan

1. Add `budget_control_point` to `erp_approval_system.dbml` and generate the migration.
2. Seed one control point per existing `budget`: `account_node_id` = the budget's
   `account_id`, `department_node_id` = its `department_id`, `cap_amount` NULL,
   `tolerance_json` translated from `control_policy`.
3. Deploy the coverage resolver and the new check path. Each seeded subtree has exactly one
   member, so `balanceAt(cp)` equals `availableBalance(budget)` and behaviour is unchanged.
4. Verify by running the existing budget and document test suites **without modification** —
   any diff is a regression, not an expected change.
5. Leave `budget.control_policy` in place, read-only and unused, for one release; drop it in
   a follow-up once nothing reads it.

**Rollback:** the check path is the only behavioural change; reverting the service code
restores per-budget checking while `budget_control_point` sits inert. No `budget_txn` row
written under either version needs interpretation differently, because posting never
changed.

## Resolved During Implementation

- **A control point may sit on any account node, postable or not.** The seed places one on
  every budget's own (postable) account, so restricting control points to summary nodes would
  make the migration impossible. `account.is_postable` restricts *posting targets*; a control
  point is a checkpoint and never a posting target. Stated in the spec and in the entity
  comment rather than left implicit.
- **Ladder ordering cannot change the outcome, so a "wrong" order is not an error.** Every
  rung whose threshold is reached applies, and a reached `BLOCK` beats a reached `WARN`. A
  ladder listing `BLOCK` before `WARN` therefore behaves identically to the reverse, and
  rejecting it would be rejecting a spelling, not a mistake. What *is* rejected, at write
  time, is an empty or unparseable ladder — that one would check nothing while appearing
  configured.
- **A `WARN` is returned on the submit response and notifies nobody.** Notification needs a
  budget owner to notify, and `budget` has no owner column yet; inventing a recipient here
  would be guessing. Owner identity is queued behind this change.
- **Raw coverage queries must run in the caller's transaction.** Found by a failing test, not
  by review: `em.getConnection().execute(...)` uses a pooled connection and does *not* join
  the caller's transaction, so the coverage resolver could not see a budget flushed moments
  earlier inside `create`. All three recursive queries now pass
  `em.getTransactionContext()`. This matters beyond that one path — the rows the resolver
  returns are the rows the caller then locks, so reading them outside the transaction would
  mean locking a set computed from a different snapshot.

## Open Questions

- `budget.control_policy` is now unread but still present, and `budget_control_point` carries
  the ladder that replaced it. The follow-up that drops the column should also decide whether
  `BudgetService.create`/`update` keep accepting `controlPolicy` as the way to spell "make the
  seeded control point block or warn", or whether callers move to the control-point API.
- Nothing yet stops an administrator creating a control point so wide (root account × root
  department) that it makes every narrower one redundant. That is legitimate configuration,
  but it is also how someone would accidentally pool every budget in a company into one
  ceiling. A warning at configuration time may be worth more than a rule.
