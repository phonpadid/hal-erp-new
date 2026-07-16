## Why

The budget adjustment and transfer intake services resolve which `document_type` to use by
matching a **hardcoded, reserved `code` string** (`BUDGET_ADJ_INC`, `BUDGET_ADJ_DEC`,
`BUDGET_TRANSFER`). This violates invariant 7 (configuration over code) and drifts from the
budget-control spec, which already states the type is identified by its `post_action`
(`ADJUST_INCREASE` / `ADJUST_DECREASE` / `TRANSFER`). A company that renames these types, or
uses different codes, breaks intake even though a correctly configured type exists.

Resolving by `post_action` is not globally unique, so a company may configure **more than one**
active document type for the same operation (e.g. two "budget increase" types with different
forms/workflows). In that case the creator SHALL choose which type to use, rather than the
server silently picking one.

## What Changes

- Resolve the adjustment / transfer `document_type` by its **`post_action`** (config-driven),
  scoped to the active company, instead of by a hardcoded `code` constant. Remove the
  `ADJUST_TYPE_CODE` / `TRANSFER_TYPE_CODE` string constants.
- When exactly one active type carries the required `post_action`, use it automatically (the
  common seeded case — no extra clicks). When none is configured, reject as "not configured".
- When **multiple** active types carry the required `post_action`, the creator SHALL select one:
  the create DTOs gain an optional `documentTypeId`; the server validates it belongs to the
  active company and carries the expected `post_action`, and rejects an ambiguous create that
  omits it.
- Add a read that lists the selectable movement document types per operation (increase /
  decrease / transfer) for the active company, `BUDGET_MANAGE`-gated.
- Frontend: the Adjust and Transfer dialogs show a type picker only when more than one type is
  available for the operation; with a single type they behave exactly as today.
- No schema change and no migration — `post_action` already exists on `document_type`.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `budget-control`: "Adjustment Document Creation" and "Transfer Request Intake" resolve the
  document type by `post_action` (per-company config), auto-use the single configured type,
  require an explicit `documentTypeId` when multiple exist, and reject when none exist; plus a
  new read exposing the selectable movement document types.
- `web-budgets`: the "Budget Adjustment Affordance" and "Budget Transfer Affordance" dialogs
  present a document-type selector when the operation has more than one configured type.

## Impact

- Backend: `back/src/modules/budget/budget-adjustment.service.ts`,
  `budget-transfer.service.ts` (lookup + selection logic), `budget.controller.ts` (new
  selectable-types read), `dto/movement.dto.ts` (optional `documentTypeId`).
- Frontend: `front-end/src/views/budgets/BudgetDetailView.vue` (adjust dialog),
  `BudgetTransferDialog.vue`, `api/budgets.ts`, `stores/budgets.ts`, i18n en/la.
- Tests: adjustment / transfer service specs (resolution by `post_action`, single / multiple /
  none paths) and any dialog smoke tests.
- No DBML or seed change (seeded types already carry the correct `post_action`).
- Invariant check: resolution stays company-scoped (invariant 1); creation still writes no
  `budget_txn` (append-only, approval-gated).
