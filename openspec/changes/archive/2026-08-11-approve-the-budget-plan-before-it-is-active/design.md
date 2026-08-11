## Context

Two paths change a budget today, and they are governed unequally.

```
adjust / transfer                        create
─────────────────                        ──────
POST /budgets/:id/adjust                 POST /budgets
  → Document (DRAFT) + BudgetMovement      → budget row, status ACTIVE
  → approval workflow                      → ensureCovered mints a control point
  → PostActionService on full approval     → returns. Nothing else happens.
  → budget_txn (append-only, doc-stamped)
```

The left path is the one this codebase already trusts: `budget-adjustment.service.ts` builds the
document, resolves the type by `post_action`, checks the department mapping, and lets
`PostActionService` apply the effect once approval completes. The right path — the one that sets
the ceiling in the first place — has no document, no approver, and no record beyond the row itself.

Three pieces of the existing machinery decide the shape of this design, and all three were verified
against the code rather than assumed:

- `budget_movement` has `@Index()` on `document`, not `@Unique` — many rows per document are
  already legal. `PostActionService.movementOf` uses `findOne`, but it is called from exactly two
  places (`post-action.service.ts:284`, `:299`, the transfer and adjust cases). The dispatcher at
  `:60` is a `switch (action)`, so a new case is purely additive.
- `budget` carries `@Unique(['fiscalYear', 'department', 'glAccount'])` with no status predicate
  (`budget.entities.ts:12`, `Migration20260617000000.ts:32`).
- `BudgetCoverageService.resolveControlPoints` resolves purely by walking the account and
  department trees; it does not filter on `budget.status`. The one place status appears
  (`budget-coverage.service.ts:273`) is the "coverage is owed to ACTIVE budgets" helper. A `DRAFT`
  budget can therefore be asked what would govern it.

## Goals / Non-Goals

**Goals:**

- No budget becomes spendable without a document that someone approved.
- A fiscal year's budget takes effect all at once, or not at all.
- Reuse the existing document → approval → post-action machinery rather than inventing a parallel
  approval path for budgets.
- Add no new table.
- Leave the coverage invariant's wording ("every `ACTIVE` budget…") untouched.

**Non-Goals:**

- Authoring tolerance ladders on the plan (see proposal — deferred, with the consequence stated).
- Auditing who changed a control point (separate concern, separate change).
- Multi-line authoring UI and spreadsheet import. The model is 1..N from the start so neither needs
  further schema work.
- Budget versions (`ORIGINAL` / `REVISED` / `FORECAST`) and time phasing. A plan is not a version;
  revising an active budget still goes through adjustment.

## Decisions

### D1 — A plan is a `Document` plus N `budget_movement` rows. No new table.

`movement_type` is `ACTIVATE_BUDGET`, `to_budget_id` points at the `DRAFT` budget, `amount` carries
the proposed `amount_total`, `reason` carries the line note. Every column the plan needs already
exists, and the row already means "this document intends to change this budget".

*Alternative considered — reuse `DocumentLine`*, which also has a nullable `budget` FK and already
supports N-per-document. Rejected on two grounds. It carries eight columns with no meaning for a
plan (`item`, `qty`, `unit`, `unitPrice`, `taxCode`, `taxAmount`, `baseLineAmount`,
`budgetBaseLineAmount`) plus a required `description`. More seriously, `DocumentLine` is what
`document-submit.service.ts:267` reads when `docType.requiresBudget` is set, and what
`post-action.service.ts:204` aggregates for `CUT_BUDGET`. A plan whose type was misconfigured with
`requires_budget = true` would reserve budget against the very budgets it is proposing.
`budget_movement` has no such path into it.

*Alternative considered — a new `budget_plan_line` table.* Cleanest semantically, but CLAUDE.md
requires a proposal before inventing a table, and the justification does not hold: `budget_movement`
fits without distortion.

### D2 — `budget.status` gains `DRAFT` and `REJECTED`; the uniqueness constraint becomes partial.

```
unique (fiscal_year_id, department_id, gl_account) where status <> 'REJECTED'
```

The constraint has to become status-aware the moment `DRAFT` rows exist, because a `DRAFT` row
occupies the slot. That occupancy is wanted — it is what stops two plans proposing the same line
concurrently, enforced by the database rather than by a check-then-insert race. What is not wanted
is a rejected plan holding the slot forever, which is exactly what an unconditional constraint
would do: the line could never be budgeted again for that fiscal year.

`REJECTED` rather than deletion. Deleting the `DRAFT` rows would dangle `budget_movement.to_budget_id`
and would erase the record of what was proposed and turned down — which is the opposite of this
change's purpose.

### D3 — Coverage moves from creation to activation.

`BudgetService.create` writes `DRAFT` and no longer calls `ensureCovered`. `ensureCovered` moves
into the activation routine, unchanged in behaviour, applied per line.

This is what keeps the coverage invariant's wording intact: it is owed to `ACTIVE` budgets, and a
budget is only `ACTIVE` after activation, at which point coverage is established in the same
transaction. `DRAFT` and `REJECTED` fall outside by construction — no spec sentence has to be
weakened to accommodate them.

### D4 — Activation is one `em.transactional`, locking existing control points in ascending id order.

**Sequence note.** Activation writes **no `budget_txn` and no `quota_usage`**. A budget's opening
figure is the `amount_total` column, not a transaction (invariant 3), so bringing a budget into
force moves no money and creates no ledger row. This is the reason activation cannot over-commit
anything, and it is worth stating because every other post-action in the module does write the
ledger.

It still takes locks, for a different reason. A control point's ceiling is the sum of the budgets
it governs, so activating a plan *raises* the ceiling of every existing control point that will
govern one of its budgets. Concurrently, `BudgetLedgerService.lockControlPoints` is reading those
same control points to decide whether a reservation fits.

```
tem = em.transactional(...)
 1. load the plan's movements, ordered deterministically (D5)
 2. resolve which EXISTING control points would govern each DRAFT budget
 3. lock those control point ids FOR UPDATE, ascending by id   ← same order as the ledger
 4. per line, in order: flip status to ACTIVE; ensureCovered (may INSERT a control point)
 5. re-verify coverage for every budget on the plan
 6. commit — or roll back the entire plan
```

Ascending-by-id is not an arbitrary convention: it is the order `lockControlPoints` already uses.
Two transactions that both lock a shared set in the same total order cannot form a cycle, so a plan
activating while documents are spending waits, and never deadlocks.

Control points *created* in step 4 need no lock — no other transaction can see the row before
commit.

The direction of the race is also benign, which is the fallback if the lock is ever bypassed:
activation only ever adds budgets to a control point, so a reservation that raced would have been
checked against a *lower* ceiling. Conservative, not over-committing. The lock is taken anyway
because "the ledger never observes a half-activated plan" is a far simpler property to reason about
than "the observable interleavings all happen to be safe".

### D5 — Lines are processed in a deterministic order, and `ensureCovered` must see its own inserts.

Two lines in one plan can require the same control point — the same account node and department
node in the same fiscal year — and `budget_control_point` carries
`@Unique(['company', 'fiscalYear', 'accountNode', 'departmentNode'])`. The second `ensureCovered`
must find the first one's insert.

It will not, as the code stands. `resolveControlPoints` memoises per `EntityManager`
(`budget-coverage.service.ts:53-57`): once a budget id has been resolved, the cached array is
returned and never recomputed. In a loop, line 2 would get its stale empty array, mint a second
control point, and fail on the unique constraint **at flush** — far from the line that caused it,
with an error naming a constraint rather than a plan.

The memo is correct for its existing callers, which resolve and then act once. Activation is the
one caller that changes the answer mid-flight, so `BudgetCoverageService` gains an `invalidate(em)`
and activation drops the memo every time it writes a point.

Resolving the whole plan up front and minting a deduplicated set in one pass is not quite enough,
which the dedupe test found rather than the design: a point minted for a budget high in the
department tree also governs the plan's budgets *below* it, and a set deduplicated only by
`(account node, department node)` would still mint a second, narrower point for those. That is a
ceiling nobody asked for, sitting on top of one that already checks them.

So the rule is **the fewest points that cover the plan**, computed as a fixpoint: mint for the
shallowest budget still uncovered, flush, invalidate, ask again. Each round removes at least the
budget it minted for and usually several more, so it terminates in as many queries as there are
points actually created — not lines.

Deterministic order — department tree depth, then department code, then `gl_account` — is what
makes the outcome reproducible, and shallowest-first is what makes the created point land as high
in the tree as the plan reaches instead of wherever the database happened to return first.

### D6 — Reject and cancel mark the plan's budgets `REJECTED`.

Handled where the existing auto-release lives (invariant 5). Nothing is released, because a plan
reserves nothing: its document type sets `requires_budget = false`, so `document-submit.service.ts`
takes no reservation at submit and there is none to give back. The only effect is the status flip,
which frees the uniqueness slot under D2.

### D7 — Budgets already `ACTIVE` are grandfathered, not back-filled.

The migration leaves them `ACTIVE` with no approving document and records in a comment that this is
deliberate. Synthesising documents and approval logs for budgets nobody approved would put false
approvals in `approval_log`, which is append-only — an unfixable lie in the one table meant to be
trustworthy. A gap that is documented is better than a record that is wrong.

### D8 — Activation is dispatched by `post_action`, like every other approval effect.

`ACTIVATE_BUDGET` joins the `switch` at `post-action.service.ts:60`. No branch anywhere reads the
plan document type's `code` (invariant 7). The plan type is seeded per company with
`requires_budget = false`, `requires_quota = false`, `requires_vendor = false`,
`requires_item = false`.

## Risks / Trade-offs

- **Deadlock between activation and reservation** → both lock `budget_control_point` rows
  `FOR UPDATE` in ascending id order (D4). A concurrency test covering activation-versus-reserve is
  part of the definition of done for this slice.
- **The memoised coverage resolver silently defeats per-line minting** → D5 resolves the whole plan
  up front and mints a deduplicated set, rather than looping `ensureCovered`. A test with two lines
  requiring one control point pins it.
- **The partial unique index changes an existing constraint** → the migration drops
  `budget_fiscal_year_id_department_id_gl_account_unique` and creates the partial index. Rollback
  requires no `REJECTED` rows to exist, which is true at the moment of deploy and stops being true
  afterwards. The down migration must say so rather than fail obscurely.
- **`POST /budgets` changes meaning without changing shape** → a caller gets a 201 and a budget that
  cannot be spent against. Marked **BREAKING** in the proposal; the only non-test callers are this
  repo's own frontend and `seed-data.ts`, both updated here. `seed-data.ts` creates its budget
  `ACTIVE` at the service layer as a grandfathered row (D7) rather than seeding a fictional
  approved plan.
- **A year can be left half-budgeted by a plan nobody submits** → out of scope to solve, but the
  budget list must show `DRAFT` budgets as such (proposal, frontend impact) so an unsubmitted plan
  is visible rather than silently absent.
- **"First line wins the ladder" survives inside a plan** → accepted, documented in the proposal,
  and made reproducible by D5's deterministic order. The control-point screens remain the place to
  set a ladder deliberately.

## Migration Plan

1. Migration A: replace the unconditional unique constraint with the partial index (D2). Safe on
   existing data — no `REJECTED` rows exist yet, so the two constraints are equivalent at that
   moment.
2. Migration B (`Migration20260812000001`): give each existing company a `BUDGET_PLAN`
   `document_type`, its published form template, and `dept_doc_type` rows.

   The routing is **borrowed, not invented**. A migration cannot decide who approves a budget —
   that is the company's decision, expressed as a `workflow` — so it copies the routing of the
   budget document type the company already approves: whoever signs off an adjustment signs off
   setting one. A company with no budget document type at all is skipped; there is nothing to
   borrow, and guessing would put a budget in front of approvers nobody chose. Those companies
   configure the type through the admin screens.

   This migration exists because the repo's convention — document types come from `seed-data.ts`,
   which never runs against an existing database — is safe for an optional type and not for this
   one. Never configuring `BUDGET_TRANSFER` costs a company transfers; never configuring
   `BUDGET_PLAN` costs it the ability to set any budget at all. Every insert is guarded by a
   `NOT EXISTS`, so it is idempotent and leaves a hand-configured type alone.
3. No data backfill (D7).
4. Rollback: dropping the partial index and restoring the unconditional one fails if any `REJECTED`
   budget rows exist. The down migration states this rather than letting Postgres report a
   duplicate-key error with no explanation.

### D9 — A plan is routed through one department and may only propose budgets for that department's subtree.

`Document` carries a single `department_id`, and it is what `dept_doc_type` maps to a form and a
workflow. A plan therefore names one routing department, and every line MUST target that department
or one of its descendants — the same subtree the department-scope rules already grant.

*Alternative considered — one plan for the whole company*, routed through the root department, which
is closer to the customer's single spreadsheet. Rejected because it makes every plan the root
department's approval regardless of whose budget it proposes: a plan is exactly as wide as the
approvers who sign it, and a company-wide plan means only company-wide approvers can ever sign one.
A department head budgeting their own subtree is the common case and would be locked out of it. The
spreadsheet is still expressible — as one plan per department, or as a root-routed plan where that
is genuinely the intent.

### D10 — Activation is refused when the fiscal year is not `OPEN`.

Bringing a budget into force in a closed year would create spendable budget for a period the rest
of the module treats as finished. This is a new rule rather than a preserved one — budget creation
today has no such check — so it is stated in the spec rather than left to be inferred, and it is
applied at activation rather than at intake: drafting next year's plan before that year opens is
legitimate, spending against it is not.

## Open Questions

None outstanding. D9 and D10 resolve the two that were open when this design was first written.
