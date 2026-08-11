## Context

What actually reads `budget.control_policy` today, found by grep rather than assumed:

```
  budget.service.ts:96      ensureCovered — picks WARN_AT_CEILING vs BLOCK_AT_CEILING for the
                            self-scoped control point minted for an uncovered new budget
  budget.service.ts:64,108  create / update — writes it
  dto/budget.dto.ts:53,64   accepted on create and update
  seed-data.ts ×3           sets it on seeded budgets
  test/budget-fixture.ts:49 chooses the fixture's ladder from it
  shared/src/index.ts       declared in the Zod schema the form validates against
  BudgetFormView.vue        rendered as a picker
```

Nothing in the reservation path reads it any more — `reserveIn` evaluates the control point's
ladder — so the column no longer decides whether a document is refused. It decides only what a
*newly minted* control point starts as.

The enum is shared. `quota.control_policy` (sick leave must warn, not block) and
`work_location.control_policy` (geofence) both use it and are untouched here.

## Goals / Non-Goals

**Goals:**

- Remove the per-budget policy without changing what a newly created budget ends up governed by.
- Keep budget creation able to express "block at the ceiling" versus "warn at it", in the vocabulary
  the control point actually uses.
- Fail a request that still sends the old field rather than ignoring it.
- Leave `quota` and `work_location` alone.

**Non-Goals:**

- Editing an existing control point's ladder from the budget screens — that is control-point
  administration, deliberately still read-only after the previous change.
- Any change to how availability is checked, locked, or posted.
- Dropping the `control_policy` enum type.

## Decisions

### D1 — Creation takes a ladder, not a policy

`CreateBudgetDto` gains an optional `tolerance`, validated by the same rung schema the control-point
API uses. When a budget needs a control point minted, that ladder is used; when the field is absent,
the ladder blocks at the ceiling.

This keeps one vocabulary for "how strictly is this checked" across the module instead of two that
have to be translated at the boundary — the translation the migration in the previous change had to
perform once already.

*Alternatives considered:* keep accepting `controlPolicy` and translate it server-side, which
preserves the caller's API at the cost of keeping the two-value vocabulary alive indefinitely — the
thing this change exists to end. Or drop the input entirely and always block at the ceiling, which
is simpler but removes the ability to create a warn-only budget without a second call to the
control-point API.

### D2 — The default is BLOCK, and it is explicit

An absent `tolerance` means block at the ceiling. That matches `budget.control_policy`'s own
`HARD_STOP` default, so no existing caller's behaviour changes by omission.

Writing the default down matters more than choosing it. The failure this change could cause is not
a wrong default but an unnoticed one: a new budget whose control point warns when everyone assumed
it blocks is invisible until something is overspent.

### D3 — Reject the removed field instead of ignoring it

DTO validation rejects `controlPolicy`. A request that states how spending should be controlled and
has that silently discarded is worse than one that fails: the caller believes it configured
something.

### D4 — The form defers to the control point

`BudgetFormView` loses the over-limit picker. Creating a budget that needs a new control point uses
the default; changing how an existing category is checked is control-point administration, which
has its own screen and is read-only until a later change opens it for editing.

*Alternative considered:* replace the picker with a tolerance-ladder editor on the budget form. That
puts control-point configuration on the wrong screen — the ladder governs a category, not the one
budget being created, and editing it from a budget form would let someone change a ceiling for
budgets they are not looking at.

### D5 — Drop the column, keep the enum

The migration drops `budget.control_policy` only. `quota` and `work_location` keep the type. The
`down` recreates the column with its original `HARD_STOP` default; it cannot restore per-budget
intent, because by then that intent lives in the control points — which is the point of having
moved it.

## Sequence and locking

This change writes no `budget_txn` and no `quota_usage`. It alters `budget` creation, which already
runs inside `inTransaction` so the budget and the control point it may mint commit together — that
boundary is unchanged and still required: a budget that briefly exists with no governing control
point is a budget that briefly cannot be checked.

No lock is added or removed. The control point remains the only row taken `FOR UPDATE` to serialize
budget work, per the previous change.

The migration is a column drop with no data movement. It must run after the control-point seed from
`Migration20260810000000`, which is what read `control_policy` to build the ladders in the first
place — dropping the column before that migration had run would leave those control points
unseeded.

## Risks / Trade-offs

- **A newly created budget silently gets a different ladder than intended.** → D2's explicit default
  plus a test that a budget created with no `tolerance` ends up governed by a point that blocks at
  100, not one that warns.
- **A caller keeps sending `controlPolicy` and is now rejected.** → Intended (D3), and the reason it
  is called out as BREAKING in the proposal. The field is only reachable from this repo's own form
  and tests, both updated here.
- **The migration runs against a database where the control-point seed has not.** → The seed
  migration precedes this one and the migrator applies them in order; the drop is safe only in that
  order, which is worth stating in the migration's own comment rather than leaving to the filename.
- **`quota` or `work_location` gets caught by an over-broad edit.** → The enum type is untouched and
  the migration names the one column; a grep for `control_policy` after the change should still find
  both of those tables.

## Resolved during implementation

- **A ladder passed when something already governs the budget is a no-op, not an error.** Creation's
  contract must not depend on configuration the caller cannot see: whether a control point already
  covers a new budget is a fact about the company's setup, not about the request. Rejecting would
  make the same request succeed or fail depending on an invisible state. The behaviour is pinned by
  a test.
- **Rejecting the removed field needed no code.** `main.ts` configures `ValidationPipe` with
  `forbidNonWhitelisted`, so dropping `controlPolicy` from the DTOs is itself what turns a request
  carrying it into a 400 — verified against the running app: `property controlPolicy should not
  exist`.
- **The seed created a budget with no control point.** Found while updating it: the migration seeds
  control points from budgets that already exist, but `seed-data.ts` runs after migrating and
  creates one of its own, which was therefore left ungoverned — a budget whose spending nothing
  checks, on every freshly seeded database. This was a gap in the earlier change, not something this
  one introduced, and it is fixed here because this is the code being touched.
- **The column was `text` with a CHECK constraint, not a PostgreSQL enum type.** So "keep the enum,
  drop the column" is simply a column drop; what survives is the TypeScript `ControlPolicy` enum,
  which `quota` and `work_location` still use. Verified after migrating: those two tables still
  carry `control_policy`, `budget` does not.

## Open Questions

None outstanding.
