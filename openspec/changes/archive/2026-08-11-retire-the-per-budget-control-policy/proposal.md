## Why

`choose-where-budget-is-controlled` replaced the binary `HARD_STOP` / `SOFT_WARNING` policy with a
tolerance ladder on the control point, and left `budget.control_policy` in place for one release
rather than dropping it in the same migration.

Calling it "unread" was wrong, and the correction matters for how this is done.
`BudgetService.ensureCovered` still reads it — when a budget is created with no control point
covering it, the policy decides whether the self-scoped control point it mints blocks or warns at
its ceiling. So the column is not dead weight to delete; it is the last input to a decision that
now belongs somewhere else. Dropping it without answering "what should that control point block at
instead" would silently change what every newly created budget does.

Two other facts shape the work. The `control_policy` enum is shared: `quota` and `work_location`
both use it and are unaffected, so the enum type stays and only the budget column goes. And the
value is still on the write path — `CreateBudgetDto` and `UpdateBudgetDto` accept it, the shared
Zod schema declares it, and the budget form renders a picker for it — so retiring the column means
deciding what that picker becomes, not just dropping a column.

## What Changes

- **Budget creation takes a tolerance ladder, not a policy.** `CreateBudgetDto` accepts an optional
  ladder for the control point it may need to mint, in the same shape the control-point API already
  validates. When omitted it defaults to blocking at the ceiling, which is what `HARD_STOP` meant
  and what the column defaults to today.
- **BREAKING: `controlPolicy` is removed from the budget create and update DTOs**, from the shared
  Zod schema, and from the budget form. A caller still sending it is rejected rather than silently
  ignored — a request that names how spending should be controlled and has that quietly dropped is
  worse than one that fails.
- **The budget form's over-limit picker becomes a tolerance picker**, or defers to the control point
  entirely — see design; either way it stops editing a field that no longer decides anything.
- **`budget.control_policy` is dropped.** The `control_policy` enum type itself stays: `quota` and
  `work_location` use it and are out of scope here.
- **`Budget.controlPolicy` leaves the entity**, and the seed data and test fixtures that set it are
  updated to express the same intent through the control point instead.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `budget-control`: budget creation no longer takes an over-limit policy; where a self-scoped
  control point is minted for a new budget, its ladder comes from the request or defaults to
  blocking at the ceiling. The per-budget policy is removed.
- `web-budgets`: the budget create/edit form no longer offers an over-limit policy.

## Impact

**Data model** — `erp_approval_system.dbml`: `budget.control_policy` removed. The `control_policy`
enum stays for `quota` and `work_location`. A migration drops the column; its `down` restores it
with the original default, which is lossy in the sense that per-budget intent already lives in the
control points by then.

**Backend** — `budget.entities.ts` (drop the property), `budget.service.ts` (`create`,
`ensureCovered`, `update`), `dto/budget.dto.ts`, `seed/seed-data.ts` (three budgets set it),
`test/budget-fixture.ts` (chooses the fixture ladder from it).

**Frontend** — `shared/src/index.ts` (Zod schema), `BudgetFormView.vue` (the picker and its two
default assignments), i18n keys for the removed field in la/en/zh, and the specs that assert the
form round-trips it.

**Permissions** — none.

**Invariants** — untouched. This removes an input to how a control point is created; it changes no
ledger, no balance formula, and no lock. Invariant 3's derived balance and invariants 2 and 4 are
not involved.

**Risk** — the real one is silence. Every budget created after this must still end up governed by a
control point with a deliberate ladder; if the default were dropped along with the column, new
budgets would get whatever the control-point service happens to default to. The coverage invariant
from the earlier change is what makes this safe to touch at all, and its tests are the ones to
watch.
