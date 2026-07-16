## 1. DTOs

- [x] 1.1 In `back/src/modules/budget/dto/movement.dto.ts`, add an optional
  `@IsOptional() @IsUUID() documentTypeId?: string` to `CreateAdjustmentDto` and
  `CreateTransferDto`.

## 2. Adjustment service — resolve by post_action with selection

- [x] 2.1 In `budget-adjustment.service.ts`, remove `ADJUST_TYPE_CODE`; derive the expected
  `post_action` from `direction` (`INCREASE → 'ADJUST_INCREASE'`, `DECREASE → 'ADJUST_DECREASE'`).
- [x] 2.2 Replace the `findOne({ code })` lookup with
  `find(DocumentType, { postAction, company: <activeCompanyId>, isActive: true })`.
- [x] 2.3 Apply selection: 0 → "not configured" reject; 1 → use it; ≥2 → require `documentTypeId`,
  else reject as ambiguous. When `documentTypeId` is given, reject unless it is one of the
  candidates (company + matching post_action + active).
- [x] 2.4 Keep the rest of the create flow (fork, movement, numbering, no `budget_txn`) unchanged.

## 3. Transfer service — resolve by post_action with selection

- [x] 3.1 In `budget-transfer.service.ts`, remove `TRANSFER_TYPE_CODE`; look up candidates by
  `find(DocumentType, { postAction: 'TRANSFER', company: <activeCompanyId>, isActive: true })`.
- [x] 3.2 Apply the same 0 / 1 / ≥2 selection and `documentTypeId` validation as the adjustment
  service.

## 4. Selectable movement types read

- [x] 4.1 Add a service method returning the active company's movement doc types grouped as
  `{ adjustIncrease, adjustDecrease, transfer }`, each `{ id, code, name }`, active only.
- [x] 4.2 Add `GET /budgets/movement-doc-types` in `budget.controller.ts`, guarded by
  `BUDGET_MANAGE`, returning that grouped payload.

## 5. Frontend — dialogs and API

- [x] 5.1 In `api/budgets.ts`, add `movementDocTypes()` calling the new read; add optional
  `documentTypeId` to the `createAdjustment` / `createTransfer` inputs.
- [x] 5.2 In `stores/budgets.ts` (or the detail view), load the movement doc types once for the
  active budget context.
- [x] 5.3 In `BudgetDetailView.vue` adjust dialog: show a required type `Select` only when the
  chosen direction has ≥2 types; send `documentTypeId` when a selector is shown (or the lone type
  when exactly one).
- [x] 5.4 In `BudgetTransferDialog.vue`: show a required type `Select` only when there are ≥2
  transfer types; send `documentTypeId` accordingly.
- [x] 5.5 Add i18n keys (en + la parity) for the type-selector label and its "choose a type"
  validation message.

## 6. Tests

- [x] 6.1 Update `budget-adjustment.service.spec.ts` fixtures to seed types with `post_action`;
  cover single-type auto-use, non-seeded-code resolution, and "not configured".
- [x] 6.2 Add adjustment spec cases: ≥2 types + no `documentTypeId` → ambiguous reject; ≥2 types
  + valid `documentTypeId` → created; invalid `documentTypeId` (inactive / other company /
  wrong post_action) → reject.
- [x] 6.3 Mirror 6.1–6.2 in `budget-transfer.service.spec.ts` for `post_action` `TRANSFER`.
- [x] 6.4 Add a test for `GET /budgets/movement-doc-types` (grouping, company-scoped active-only,
  `BUDGET_MANAGE` gate).
- [x] 6.5 Run the budget module suite and confirm green.

## 7. Verification

- [x] 7.1 Grep the backend for `BUDGET_ADJ_INC`, `BUDGET_ADJ_DEC`, `BUDGET_TRANSFER`; confirm no
  references remain outside `seed-data.ts`.
- [x] 7.2 Manually verify: a single-type company creates an adjustment and a transfer with no
  picker (unchanged UX); a company with two increase types shows the picker and creates against
  the chosen type; no `budget_txn` until approval in all cases.
