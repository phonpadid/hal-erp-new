## 1. Backend — create-adjustment service + endpoint

- [x] 1.1 Add `CreateAdjustmentDto` in `back/src/modules/budget/dto/` — `{ direction: 'INCREASE' | 'DECREASE', amount: @IsNumberString, reason: @IsString (non-empty) }` (budgetId comes from the path param).
- [x] 1.2 Add a service method (e.g. `BudgetAdjustmentService.create(budgetId, dto)`) that runs in one `em.transactional`: verify the budget belongs to the active company; resolve the adjustment `document_type` for the direction and the budget's department via `DeptDocTypeService`; issue a doc number via `NumberingService` (PESSIMISTIC_WRITE); create the `document` (DRAFT, active company, pinned template + workflow); create the `budget_movement` (`toBudget` = the budget, `amount`, `reason`, company = active). Write NO `budget_txn`. Return the new document id.
- [x] 1.3 Add `POST /budgets/:id/adjustments` to `budget.controller.ts` with `@RequirePermissions(BUDGET_MANAGE)` and `ParseUUIDPipe` on `:id`; return `{ documentId }`.
- [x] 1.4 If no adjustment doc type is mapped for the budget's department, throw a clear `BadRequestException` (unroutable document) rather than creating one.

## 2. Configuration / seed

- [x] 2.1 In `seed-data.ts`, upsert two adjustment document types: `BUDGET_ADJ_INC` (`postAction: 'ADJUST_INCREASE'`) and `BUDGET_ADJ_DEC` (`postAction: 'ADJUST_DECREASE'`), `requiresBudget: false`, active.
- [x] 2.2 Upsert a `form_template` (+ minimal fields if needed) and `dept_doc_type` mappings for both types → demo department + existing approval workflow, so created adjustments are routable.

## 3. Frontend — budget detail adjust affordance

- [x] 3.1 Add `createAdjustment(budgetId, { direction, amount, reason })` to `front-end/src/api/budgets.ts` (POST `/budgets/:id/adjustments`, returns `{ documentId }`).
- [x] 3.2 In `BudgetDetailView.vue`, add an "Adjust" button in the detail header actions, gated `v-can="'BUDGET_MANAGE'"`; open a dialog with direction (increase/decrease), amount (kept as string), reason (Textarea).
- [x] 3.3 Validate the dialog with one Zod schema `{ direction, amount: positive decimal string, reason: non-empty }`; show inline field errors; block submit on invalid.
- [x] 3.4 On confirm, call `createAdjustment`, then `router.push` to `document-detail` for the returned id; handle/display API errors.
- [x] 3.5 Add i18n keys (en + la parity) for the button, dialog title, direction labels, amount, reason, and validation messages; use PrimeUI theme tokens only (light/dark).

## 4. Tests

- [x] 4.1 Backend unit/integration: creating an adjustment produces a `document` + `budget_movement` and NO `budget_txn`; the budget's derived available is unchanged until approval.
- [x] 4.2 Backend: after the created adjustment document is fully approved, exactly one `ADJUST_INCREASE` (resp. `ADJUST_DECREASE`) is written and available reflects it (reuse the post-action path).
- [x] 4.3 Backend: the endpoint rejects a budget from another company (404/400) and rejects when no adjustment doc type is mapped for the department.
- [x] 4.4 Frontend: the Adjust button is hidden without `BUDGET_MANAGE`; the dialog blocks invalid input; a valid confirm calls the API and routes to the document. Run `pnpm test` (front) and the budget vitest suite (back, against the test DB).
