## 1. Data model — budget base

- [x] 1.1 Add `budget_exchange_rate` + `budget_base_total_amount` to `document` and `budget_base_line_amount` to `document_line` in `erp_approval_system.dbml` (decimal, nullable).
- [x] 1.2 Add the matching MikroORM entity fields (nullable) + a migration adding the three columns.

## 2. Backend — stamp + reserve at the budget rate

- [x] 2.1 In `DocumentSubmitService.submit`, resolve the `BUDGET_RATE` (`rateType: 'BUDGET_RATE'`) for doc→base, falling back to the already-resolved daily rate when it throws; build a `budgetToBase(amount)` rounding to the base `decimal_places`.
- [x] 2.2 Stamp `budget_exchange_rate` / `budget_base_total_amount` / per-line `budget_base_line_amount` alongside the daily fields, and reserve budget using the per-line **budget** base (`reserveLines.baseAmount = budgetToBase(lineAmount)`).
- [x] 2.3 Unit tests: a foreign-currency PR with a `BUDGET_RATE` reserves at the budget rate and records the daily rate/base; with no `BUDGET_RATE` the budget base equals the daily base.

## 3. Backend — settle + approval threshold on the budget base

- [x] 3.1 `PostActionService.cutBudget`: aggregate and settle using `document_line.budget_base_line_amount` (fallback `base_line_amount`), so reserve and settle use the same basis.
- [x] 3.2 `WorkflowStepResolver.applicableSteps`: compare step bands against `document.budget_base_total_amount` (fallback `base_total_amount`).
- [x] 3.3 Unit tests: a foreign-currency PR reserves then settles to zero outstanding at the budget base; a document is banded by its budget base, not its daily base (e.g. a daily-rate amount that would cross a band does not when the budget rate keeps it under).

## 4. Verification

- [x] 4.1 Backend unit tests green (`vitest`); migration applies; existing budget/approval/document specs still pass (same-currency unaffected).
- [ ] 4.2 Manual smoke: with a `BUDGET_RATE` and a different daily rate, submit a foreign-currency PR; confirm the reservation uses the budget rate, the document shows the daily rate, and approval routing bands by the budget base.
