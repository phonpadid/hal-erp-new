## Context

`BudgetAdjustmentService` and `BudgetTransferService` create an approvable document by first
resolving its `document_type`. Today they resolve it by a hardcoded, reserved `code`:

- `budget-adjustment.service.ts` — `ADJUST_TYPE_CODE = { INCREASE: 'BUDGET_ADJ_INC', DECREASE: 'BUDGET_ADJ_DEC' }`
- `budget-transfer.service.ts` — `TRANSFER_TYPE_CODE = 'BUDGET_TRANSFER'`

`document_type` already carries `post_action` (`ADJUST_INCREASE` / `ADJUST_DECREASE` /
`TRANSFER`), which is the real config that drives behavior on approval and is what the
budget-control spec already references. `post_action` is unique-by-code but **not** unique on
its own, so a company may configure two active types for the same operation. The intake is
invoked from dedicated budget dialogs (the user enters budget + amount + direction, not a
document type), so today there is no place to disambiguate.

## Goals / Non-Goals

**Goals:**
- Resolve the adjustment / transfer `document_type` by `post_action` (config), not by a
  hardcoded `code`, scoped to the active company.
- Keep the common single-type case zero-click and behaviorally identical to today.
- When multiple types share the operation's `post_action`, let the creator choose which one,
  validated server-side.
- Bring the code back in line with the existing budget-control spec.

**Non-Goals:**
- No new column, migration, or `system_role` marker (reusing `post_action`).
- No change to how the post-action writes ledger rows on approval.
- No DBML or seed change.
- No change to the input surface: the movement content stays captured by the dedicated
  Adjust / Transfer dialog and stored on `budget_movement`. Selecting a `documentTypeId` only
  chooses the type (its workflow / routing on approval); it does NOT render the config-driven
  `form_template` / `form_field` and does NOT route to the generic `/documents/new` create flow.
  After create, the client continues to route to the created document's detail page
  (`/documents/:id`) to submit for approval, exactly as today. Custom `form_field`s on a
  movement type are out of scope (these are treated as system movement types).

## Decisions

**Decision: resolve candidates by `(post_action, company, is_active)`, then pick.**
Replace the single `findOne(..., { code })` with `find(DocumentType, { postAction, company, isActive: true })` and apply this selection rule:

| Candidates | `documentTypeId` in DTO | Result |
|---|---|---|
| 0 | — | reject: "not configured" (`BadRequestException`) |
| 1 | omitted | use the single candidate (today's behavior) |
| 1 | provided | must equal that candidate, else reject |
| ≥2 | omitted | reject: "multiple types configured — select one" |
| ≥2 | provided | must be one of the candidates, else reject |

For adjustments `postAction` is chosen from `direction` (`INCREASE → 'ADJUST_INCREASE'`,
`DECREASE → 'ADJUST_DECREASE'`); for transfers it is the constant `'TRANSFER'`. Direction still
comes from configuration, matching the spec's "direction comes from post_action" scenario.

- *Why over hardcoded `code`*: `post_action` is the actual behavioral config and is already
  spec-referenced; keying off it removes reserved-code coupling.
- *Why over adding `system_role`*: `post_action` already identifies the operation; a new column
  duplicates it and forces a migration for no functional gain.
- *Why require an explicit choice on ambiguity (over silent pick)*: silently choosing one type
  hides a real business decision (which form/workflow) and would be non-deterministic.

**Decision: validate `documentTypeId` against the candidate set, not just by id.**
A provided `documentTypeId` must resolve to a type that is in the active company AND carries the
expected `post_action` AND is active — otherwise the request is rejected. This prevents a client
from routing an adjustment through an unrelated document type (invariant 1 + configuration
integrity).

**Decision: expose selectable movement types via one read.**
Add `GET /budgets/movement-doc-types` (`BUDGET_MANAGE`) returning, for the active company:
`{ adjustIncrease: Option[], adjustDecrease: Option[], transfer: Option[] }`, where
`Option = { id, code, name }`, active types only. The detail view loads it once; both dialogs
read from it. A single grouped read keeps the frontend to one request and avoids per-dialog
round trips.

**Decision: frontend shows the picker only when needed.**
Each dialog looks at its operation's option list: length ≤ 1 → no selector, submit without (or
with the lone) `documentTypeId`, exactly as today; length ≥ 2 → render a required `Select` and
send the chosen `documentTypeId`. This keeps seeded single-type companies unchanged.

## Risks / Trade-offs

- **Client omits `documentTypeId` when ≥2 exist** → server rejects with a clear "select one"
  error. Mitigation: the dialog makes the selector required before enabling submit; the server
  guard is the backstop.
- **A stale option list (type deactivated between load and submit)** → server re-validates
  against `is_active` and the candidate set at submit, so a stale pick is rejected. Mitigation:
  server is source of truth; dialog can reload on error.
- **Two types with the same `post_action` and identical names** → picker shows both by `code`
  (unique per company), so they remain distinguishable.
- **Test fixtures that seed a type only by `code`** → must set `post_action` to resolve.
  Mitigation: update the adjustment / transfer service specs.

## Migration Plan

Code-only change; no data migration. Deploy backend (service + DTO + read) and frontend
together. The DTO field is additive and optional, so an older client keeps working against the
new server for single-type companies. Rollback is a straight revert — no schema or data state
changes.

## Open Questions

None. Enforcing at most one active type per `(company, post_action)` at the DB level is
intentionally deferred — multiplicity is now a supported case handled by the picker.
