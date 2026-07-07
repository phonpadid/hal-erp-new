## Why

The spec already requires a budget adjustment to be an **approvable document** that writes a
single `ADJUST_INCREASE` / `ADJUST_DECREASE` on approval (budget-control: *Budget Adjustment*),
and the post-action engine already executes the ADJUST when such a document is fully approved.
But the flow is unreachable: **nothing creates the `budget_movement`** the post-action reads, no
adjustment `document_type` is configured, and there is no UI to start an adjustment. Users on the
budget detail screen have no way to raise or lower a budget through the approval-gated path the
spec mandates.

This change closes that gap end to end: a "ปรับงบ / Adjust" action that creates an approvable
adjustment document (carrying a `budget_movement`), which then flows through the existing
submit → approval → post-action chain. It deliberately does **not** add a direct, approval-bypassing
adjust path (that would violate the approval-gating invariant and the spec).

## What Changes

- **Adjustment document + movement (backend).** Add a service/endpoint that, in one transaction,
  creates a `document` of an adjustment type plus its `budget_movement` row
  (`to_budget` = the target budget, `amount`, `reason`, direction). The document then uses the
  existing draft → submit → approval flow; on full approval the existing
  `PostActionService.adjust` writes the single ADJUST txn. No new ADJUST write path.
- **Configuration/seed.** Seed two adjustment document types — `post_action = ADJUST_INCREASE`
  and `post_action = ADJUST_DECREASE` — mapped to a department + approval workflow, so direction
  comes from configuration (invariant 7), not hardcoded branching.
- **UI (frontend).** On `BudgetDetailView`, add an "Adjust" action (gated by `BUDGET_MANAGE`)
  that opens a dialog: direction (increase/decrease), amount (string/Decimal — never a JS number),
  and reason. Submitting creates the adjustment document and routes to its detail page so it can
  be submitted for approval. Labels via i18n (en/la), PrimeUI theme tokens only.
- **No change** to the append-only ledger math or the existing manual `POST /budgets/adjust`
  stopgap behavior.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `budget-control`: add a requirement that the system SHALL let an authorized user **create** a
  budget adjustment document carrying a `budget_movement`, so the existing approval → post-action
  path can execute the ADJUST. (Complements the existing *Budget Adjustment* requirement, which
  only covered the on-approval write.)
- `web-budgets`: add a requirement for the budget-detail Adjust affordance (button + dialog),
  gated by `BUDGET_MANAGE`.

## Impact

- Backend: `back/src/modules/budget/` (new create-adjustment service + endpoint + DTO),
  `back/src/seed/seed-data.ts` (adjustment document types + dept/workflow mapping). Reuses
  `NumberingService`, `DeptDocTypeService`, `PostActionService.adjust`, `executeAdjustment`.
- Frontend: `front-end/src/views/budgets/BudgetDetailView.vue`, `src/api/budgets.ts`, budget i18n.
- Invariants reinforced: approval-gating + no-self-approval (adjustment goes through workflow),
  append-only ledger (ADJUST written once on approval), config-driven behavior (post_action),
  company isolation (movement + document scoped to the active company).
- No DBML change: `budget_movement` and `budget_txn.document_id` (not null) are used as designed.
