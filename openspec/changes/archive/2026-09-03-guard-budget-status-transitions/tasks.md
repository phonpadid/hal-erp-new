## 1. Declare the status set

- [x] 1.1 In `shared/src/index.ts`, add `INACTIVE` to `BUDGET_STATUSES`; leave `COUNTED_BUDGET_STATUSES` and `isCountedBudget` untouched, and replace the docblock note that calls `INACTIVE` an undeclared value with what it now means (a suspended budget, counted in no total, unspendable)
- [x] 1.2 In the same file, narrow the budget update schema's `status` from `z.string().max(50)` to the `BUDGET_STATUSES` enum, so the client refuses exactly what the server would
- [x] 1.3 Export the sanctioned transition map from `@erp/shared` — `ACTIVE → INACTIVE|CLOSED`, `INACTIVE → ACTIVE|CLOSED`, and nothing out of `DRAFT`, `REJECTED` or `CLOSED` — so the guard and the form read the same source
- [x] 1.4 `pnpm --filter @erp/shared build` — the backend imports the built CommonJS `dist` while vite aliases the TS source, so a stale build fails only on the server

## 2. Migration

- [x] 2.1 Add a migration putting a CHECK constraint on `budget.status` admitting the five declared values; no backfill (the database holds 230 ACTIVE, 5 REJECTED, 1 DRAFT and no undeclared value)
- [x] 2.2 Write its `down` to drop the constraint
- [x] 2.3 Run `pnpm --filter back migration:up` against an EMPTY database and confirm the schema the migrations build matches the entities

## 3. The budget update guard

- [x] 3.1 In `back/src/modules/budget/dto/budget.dto.ts`, replace `@IsString() @MaxLength(50)` on `UpdateBudgetDto.status` with `@IsIn([...BUDGET_STATUSES])` — matching the filter DTO on the same module, which is already constrained
- [x] 3.2 In `budget.service.ts`, replace `if (dto.status !== undefined) budget.status = dto.status;` with a transition check against the shared map: same status is a no-op, a sanctioned move is applied, anything else throws a `BadRequestException` naming BOTH the current and the requested status
- [x] 3.3 Keep the refusal ahead of any other write in `update`, so a rejected transition leaves the budget's name and account untouched rather than half-edited
- [x] 3.4 Leave `BUDGET_MANAGE` as the gate — this governs what the permission may author, not who holds it

## 4. Activation refuses a non-DRAFT budget

- [x] 4.1 In `budget-plan.service.ts` `activate`, after the budgets are loaded and before any status is written, throw naming the budget and its status if any is not `DRAFT`; match the message shape `raisePlan` and `repropose` already use
- [x] 4.2 Refuse the whole plan rather than skipping the offending line — a document reading as fully approved over budgets that were never put in force is worse than a refusal
- [x] 4.3 Confirm by reading the path that the guard sits inside the transaction `activate` already holds, so a refused activation leaves no control point behind

## 5. RETURN stops rejecting a plan's budgets

- [x] 5.1 Remove the `markRejected` call from `DocumentSubmitService.releaseDocumentHolds`, and update its docblock: it releases holds, it does not pass verdicts
- [x] 5.2 Call `markRejected` from the `REJECT` branch of `ApprovalRoutingService.act`, inside the same transaction as the terminal transition and under the pessimistic lock it already takes
- [x] 5.3 Call it from the withdrawal path too, in the same transaction that sets `CANCELLED`
- [x] 5.4 Verify by reading the paths that `RETURN` still releases budget, quota and stock, and now marks nothing
- [x] 5.5 Leave `markRejected` itself unchanged — its `status: DRAFT` query filter is what makes it idempotent, and that stays

## 6. Frontend

- [x] 6.1 In `BudgetFormView.vue`, derive `statusOptions` from the current budget's status via the shared transition map instead of the fixed `ACTIVE`/`INACTIVE`/`CLOSED` list
- [x] 6.2 When the current status has no sanctioned move (`DRAFT`, `REJECTED`, `CLOSED`), hide the picker and state why — a draft waits on its plan, a rejected line is proposed again, a closed budget's year has run
- [x] 6.3 `BudgetListView.vue`'s status filter picks `INACTIVE` up from `BUDGET_STATUSES` with no change of its own — but its labels come from the nested `budgets.list.status` block, which needed the `INACTIVE` key added in all three locales or the new option would render as a missing key
- [x] 6.4 Add the three i18n strings for the no-move explanations in `en`, `la` and `zh` (`budgets.status.*` labels already exist in all three)

## 7. Tests

- [x] 7.1 Transition unit tests: `ACTIVE`↔`INACTIVE` and both → `CLOSED` succeed; `REJECTED → ACTIVE`, `REJECTED → DRAFT`, `ACTIVE → DRAFT`, `DRAFT → ACTIVE` and `CLOSED → ACTIVE` are refused naming both statuses; same-status is a no-op
- [x] 7.2 DTO test: an undeclared status is refused at validation, before the budget is loaded
- [x] 7.3 Migration test: the CHECK constraint refuses an undeclared status written directly — verified by hand against a database built from the migrations (`erp_migcheck`), NOT automated: `test-orm` builds its schema from the entities via `refreshDatabase`, so the constraint does not exist in any test database and an automated assertion would fail for the wrong reason
- [x] 7.4 Activation tests: a plan carrying a `REJECTED` budget is refused and activates NO line and creates NO control point; a plan of all-`DRAFT` budgets still activates as before
- [x] 7.5 **The regression this change exists for:** submit a plan → an approver RETURNS it → assert its budgets are still `DRAFT` → resubmit → approve → assert they become `ACTIVE`. Before this change the same sequence marked them `REJECTED` and then revived them
- [x] 7.6 Terminal-outcome tests: REJECT marks the plan's budgets `REJECTED`; withdrawal marks them `REJECTED`; both leave the rows in place and write no `budget_txn`
- [x] 7.7 Assert `RETURN` still releases budget, quota and stock holds for an ordinary (non-plan) document — the invariant-5 behaviour must not regress while the plan-specific call moves
- [x] 7.8 Front-end tests: the picker offers three options for `ACTIVE` and for `INACTIVE`, and none for `DRAFT`, `REJECTED` and `CLOSED`; the list filter offers all five

## 8. Verify

- [x] 8.1 `pnpm --filter back test` and `pnpm --filter front-end test` green; `tsc --noEmit -p back/tsconfig.build.json` and `vue-tsc` clean. Do NOT run `pnpm --filter back lint` — it is `eslint --fix` against a config the committed code does not satisfy, and it rewrites hundreds of files
- [x] 8.2 In the running app, open an `ACTIVE` budget and confirm the picker offers exactly three statuses; open one of the `REJECTED` budgets on node `1.102` and confirm it offers no move and says why
- [x] 8.3 Confirm the budget list's status filter now offers `INACTIVE`
