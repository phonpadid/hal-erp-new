## 1. Module scaffolding & DTOs

- [x] 1.1 Create `BudgetControlModule` (`MikroOrmModule.forFeature([Budget, BudgetTxn, BudgetMovement])`); register in `AppModule`.
- [x] 1.2 Add permission-code constants `BUDGET_VIEW`, `BUDGET_MANAGE` in a module `permissions.ts`.
- [x] 1.3 Add class-validator DTOs: create/update budget (`fiscalYearId`, `departmentId`, `glAccount`, `budgetName?`, `amountTotal` as `@IsNumberString`, `controlPolicy?`); transfer-exec and adjust-exec DTOs (movement ids / budget ids + `amount`).

## 2. Budget registry & derived balance

- [x] 2.1 `BudgetService`: create/update/list/get budgets (unique fiscal_year+department+gl_account). `amount_total` set at creation, never overwritten by ledger ops.
- [x] 2.2 `BudgetBalanceService.availableBalance(budgetId, em?)`: `amount_total + ADJUST_INCREASE − ADJUST_DECREASE + TRANSFER_IN − TRANSFER_OUT − RESERVE − ACTUAL + RELEASE` via a grouped SUM over `budget_txn` + `Money`/`Decimal` (string math). Add `outstandingReserved(documentId, budgetId, em)` = `Σ RESERVE − Σ RELEASE − Σ ACTUAL`.
- [x] 2.3 `BudgetController`: CRUD guarded by `BUDGET_MANAGE`/`BUDGET_VIEW`; `GET /budgets/:id/balance` (`BUDGET_VIEW`); `ParseUUIDPipe` on ids; `JwtAuthGuard` + `PermissionsGuard`.

## 3. Reserve / actual / release (append-only, locked)

- [x] 3.1 `BudgetLedgerService.reserve(documentId, lines, opts)`: group lines by `budgetId`; in one `inTransaction`, lock each budget `FOR UPDATE` (ordered by id), recompute available inside the txn, enforce control policy (HARD_STOP throws on insufficient → whole submit rolls back; SOFT_WARNING collects a warning), insert one RESERVE `budget_txn` per budget. Return `{ warnings }`.
- [x] 3.2 `settle(documentId, budgetId, actualAmount)`: insert ACTUAL `actualAmount` + RELEASE `outstanding − actualAmount` (reject if `actualAmount > outstanding`); both in one transaction.
- [x] 3.3 `releaseAll(documentId)`: RELEASE the current outstanding reserved per budget for the document (reject/cancel frees everything; idempotent when outstanding is 0).
- [x] 3.4 Writes are insert-only `budget_txn`; rely on `LedgerGuardSubscriber` for update/delete protection (use `AppendOnlyRepository` for the typed surface).

## 4. Transfer & adjustment execution

- [x] 4.1 `executeTransfer(movement)`: reject cross-company (via `department`/`fiscalYear` → company) and cross-fiscal-year; in one `inTransaction` lock both budgets, require `availableBalance(from) >= amount`, insert paired TRANSFER_OUT + TRANSFER_IN atomically.
- [x] 4.2 `executeAdjustment(movement)`: insert a single ADJUST_INCREASE / ADJUST_DECREASE per `movementType`.
- [x] 4.3 Manual-ops endpoints (guarded by `BUDGET_MANAGE`) to execute a transfer/adjustment until approval-workflow drives them.

## 5. Tests (business rules + concurrency + append-only)

- [x] 5.1 Derived balance: RESERVE then RELEASE yields the invariant-3 formula; `amount_total` unchanged. Multi-line submit creates one RESERVE per budget equal to that budget's summed base amount.
- [x] 5.2 Over-limit policy: HARD_STOP rejects an over-budget reserve; SOFT_WARNING allows and returns a warning.
- [x] 5.3 Reserve→actual→release: settle 90,000 against a 100,000 reservation → ACTUAL 90,000 + RELEASE 10,000, outstanding 0. Reject/cancel auto-releases the full outstanding.
- [x] 5.4 Concurrency: two concurrent reserves of the full available against a HARD_STOP budget → exactly one succeeds (uses `lockForUpdate` + `inTransaction`).
- [x] 5.5 Transfer: paired TRANSFER_OUT + TRANSFER_IN atomic; rejected across companies and across fiscal years; rejected when source available is insufficient. Adjustment: ADJUST_INCREASE raises derived balance.
- [x] 5.6 Append-only: attempting to update a persisted `budget_txn` throws (LedgerGuardSubscriber).

## 6. Verify

- [x] 6.1 `pnpm --filter back build` and `pnpm --filter back test` pass.
- [x] 6.2 Run `openspec validate implement-budget-control --strict`.
