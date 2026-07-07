## 1. Backend — transfer document type seed

- [x] 1.1 Add a `BUDGET_TRANSFER` document type to `back/src/seed/seed-data.ts` with `post_action = 'TRANSFER'`, category FINANCE, `requires_budget: false`, `requires_quota: false`, mapped to the same departments as the adjustment types (mirror the `BUDGET_ADJ_*` seeding block).
- [x] 1.2 Run the seed against a dev DB and confirm a `document_type` row with code `BUDGET_TRANSFER` and `post_action = TRANSFER` exists.

## 2. Backend — transfer intake (service, DTO, controller)

- [x] 2.1 Add `CreateTransferDto { fromBudgetId: UUID, toBudgetId: UUID, amount: IsNumberString, reason: IsString @IsNotEmpty }` to `back/src/modules/budget/dto/movement.dto.ts`.
- [x] 2.2 Add `BudgetTransferService.create(dto)` in `back/src/modules/budget/budget-transfer.service.ts`, mirroring `BudgetAdjustmentService`: take active company from `RequestContext`; resolve `from`/`to` via the company-scoped `BudgetService.get` (NotFound if cross-company); assert `from !== to`, same company, same `fiscal_year`, and `amount > 0`; resolve the `BUDGET_TRANSFER` doc type and the source budget's department routing via `DeptDocTypeService.resolve`; in one `em.transactional()` allocate the doc number via `NumberingService.next` (SELECT FOR UPDATE) and persist the `Document` (status DRAFT) plus a `BudgetMovement` (`movement_type` `TRANSFER`, `from_budget`, `to_budget`, `amount`, `reason`). Write NO `budget_txn`. Return `{ documentId }`.
- [x] 2.3 Register `BudgetTransferService` in `BudgetControlModule` providers (and exports if needed by other modules).
- [x] 2.4 Add `POST /budgets/transfers` to `back/src/modules/budget/budget.controller.ts`, guarded `@RequirePermissions(P.BUDGET_MANAGE)`, delegating to `BudgetTransferService.create`.

## 3. Backend — transfer intake tests

- [x] 3.1 Unit test: intake creates exactly one `document` + one `budget_movement` (`TRANSFER`) and zero `budget_txn`; neither budget's derived balance changes.
- [x] 3.2 Unit test: intake rejects same-budget, cross-company, cross-fiscal-year, and non-positive amount before creating anything.
- [x] 3.3 Unit test: intake rejects a budget outside the active company as not found; rejects callers lacking `BUDGET_MANAGE` (403).
- [x] 3.4 Post-action integration test: a transfer document created by the intake, when fully approved, writes paired `TRANSFER_OUT`/`TRANSFER_IN` atomically with both budgets locked (reuse/extend the existing `executeTransfer` concurrency coverage; assert exactly one of two concurrent over-committing transfers succeeds).

## 4. Frontend — API client and store

- [x] 4.1 In `front-end/src/api/budgets.ts` add `create(input)` → `POST /budgets`, `update(id, input)` → `PATCH /budgets/:id`, and `createTransfer(input)` → `POST /budgets/transfers` (returns `{ documentId }`), with typed inputs mirroring the backend DTOs (amounts as strings).
- [x] 4.2 In `front-end/src/stores/budgets.ts` add `createBudget`, `updateBudget`, and `createTransfer` actions wrapping the API calls with error handling.

## 5. Frontend — create/edit budget view

- [x] 5.1 Add `front-end/src/views/budgets/BudgetFormView.vue` with a `@primevue/forms` form + Zod schema (`zodResolver`) mirroring `CreateBudgetDto`/`UpdateBudgetDto`; create mode captures fiscal year, department, GL account, name, `amountTotal` (string, positive-decimal), and control policy; edit mode shows only name/policy/status and renders `amountTotal` read-only with a hint pointing to Adjust.
- [x] 5.2 Add routes `budgets/new` and `budgets/:id/edit` in `front-end/src/router/index.ts` with `meta.permission = 'BUDGET_MANAGE'`.
- [x] 5.3 Add a `v-can="'BUDGET_MANAGE'"` "New budget" action on `BudgetListView` and an "Edit" action on `BudgetDetailView`; on save route to the budget detail.

## 6. Frontend — transfer affordance

- [x] 6.1 Add `front-end/src/views/budgets/BudgetTransferDialog.vue` gated by `BUDGET_MANAGE`: pick source and destination budget (same company + fiscal year), display each budget's derived available balance for guidance, enter amount (string) and reason; Zod validation blocks same-budget / empty / non-positive amount / empty reason before submit.
- [x] 6.2 On confirm, call `createTransfer` and route the user to `/documents/:documentId`; never mutate budget balances client-side.
- [x] 6.3 Add a `v-can="'BUDGET_MANAGE'"` "Transfer" action that opens the dialog from `BudgetDetailView` (pre-selecting the current budget as source).

## 7. Frontend — money formatting fix

- [x] 7.1 Resolve the company base currency `decimal_places` from the active-company Pinia context and format every amount in `BudgetListView.vue` and `BudgetDetailView.vue` (list totals/available, breakdown components, ledger amounts) via `useFormat().formatMoney` / `formatAmount(x, decimalPlaces)` — remove the hardcoded 2-decimal default; keep amounts as string/Decimal end-to-end.

## 8. Frontend — i18n and tests

- [x] 8.1 Add all new labels/messages (budget create/edit, transfer dialog, validation errors) to `front-end/src/i18n/locales/en/budgets.ts` and `.../la/budgets.ts` with full en/la parity.
- [x] 8.2 Vitest store tests for `createBudget`, `updateBudget`, and `createTransfer` (success + error paths).
- [x] 8.3 Vitest component/validation tests for the create/edit form and transfer dialog (required-field and same-budget/non-positive blocking; amount carried as string).
- [x] 8.4 Vitest test asserting budget amounts format with the currency's `decimal_places` (e.g. 0-decimal and 3-decimal cases).

## 9. Verification

- [x] 9.1 Run backend and frontend test suites; confirm new tests pass and no regression in existing budget specs.
- [ ] 9.2 Manual smoke (or e2e where available): create a budget by dimension, raise a transfer that routes to its document, confirm balances are unchanged until approval, and confirm amounts render with the correct decimal places in light and dark mode.
