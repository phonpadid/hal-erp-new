## Context

`CreateDocumentView.vue` computes `canBudget = auth.can('DOC_CREATE')` and passes it to
`LineItemsEditor.vue`, which shows the fallback budget picker (`canBudget && !line.itemId`)
and the resolved-budget chip (`canBudget && line.itemId`). Because `canBudget` is a bare
permission, budget UI appears on item-less lines of every type, including non-budget ones.
Separately, the item picker is always optional, so `requires_item` types give no signal until
the server rejects submit. The creatable-types read already returns `requiresItem` (added by
`line-item-budget-enforcement`); the wizard just doesn't consume it.

## Goals / Non-Goals

**Goals:**
- Budget affordances appear only for `requires_budget` types.
- `requires_item` makes the line item required with an inline client block on save/submit.
- Client-side flag for a positive line with no item and no budget on `requires_budget` types.
- Keep client validation a faithful, UX-only mirror of the server rules.

**Non-Goals:**
- No backend/DTO/schema change; the server stays authoritative and already enforces all three.
- Not re-deriving the exact resolved budget for item lines on the client (the server owns
  that); the client only knows an item line *will* resolve or the server rejects it.
- No change to the detail/read views or to non-`Create` flows.

## Decisions

- **Gate on the selected type, not the permission.** Pass `requiresBudget` and `requiresItem`
  (from `selectedType()`) into `LineItemsEditor`. The budget picker shows when
  `requiresBudget && !line.itemId`; the resolved-budget chip when `requiresBudget &&
  line.itemId`; permission (`DOC_CREATE`) is already implied by being in the wizard.
  `canMaster` (MASTER_VIEW) still governs the item picker's visibility.
- **`requires_item` marks the item required and blocks item-less lines.** The item field gets
  a visible required indicator + `aria-required`; the lines step fails to advance / submit
  when any line has no `itemId`, with an inline message on the offending line. Enforced
  client-side for UX; the server still rejects (verbatim message surfaced).
- **Budget-coverage mirror targets the checkable case only.** The client flags a line that
  has a positive amount, **no item**, and no selected `budgetId` on a `requires_budget` type.
  Item-backed lines are trusted to resolve server-side (the server derives or rejects with a
  specific error), so the client does not attempt to reproduce the GL→budget resolution.
- **Reuse the existing validation channel.** Extend the wizard's line-step validation (the
  same path that blocks negative/non-numeric qty via `lineInvalid`) so the new checks surface
  through the established inline-error + step-failure + focus mechanics, not a new banner.

## Risks / Trade-offs

- **Client and server rules could still diverge over time** → mitigation: the client rules are
  written to mirror the two prior changes exactly, and the server rejection is always surfaced
  verbatim, so a divergence degrades to a clear server error rather than a silent pass.
- **An item line the client thinks is fine but the server can't resolve a budget for** (e.g.
  no active budget for that GL/department/year) → the client can't know this; the server
  reject with its specific message remains the backstop, shown verbatim on submit.
- **Hiding budget UI on non-budget types changes what some users see** → intended: those types
  never budget, so the control was noise; no data is affected.

## Open Questions

- Should the wizard also block *advancing past* the lines step (not just submit) when
  `requires_item` is violated, or only at submit? Current decision: block at the lines-step
  advance like other line validation, for the earliest feedback. Revisit if it feels too eager
  for long multi-line drafts.
