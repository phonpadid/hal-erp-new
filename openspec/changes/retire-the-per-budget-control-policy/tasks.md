## 1. Move creation onto the ladder vocabulary

- [ ] 1.1 Add an optional `tolerance` to `CreateBudgetDto`, validated by the same rung schema `CreateControlPointDto` uses, so there is one vocabulary for "how strictly is this checked" rather than two that need translating at the boundary
- [ ] 1.2 Use it in `BudgetService.ensureCovered` for the control point it mints; default to blocking at the ceiling when absent, which is what `HARD_STOP` meant
- [ ] 1.3 Reject the removed `controlPolicy` field on create and update rather than ignoring it — a caller that states how spending is controlled and is silently overruled believes it configured something
- [ ] 1.4 Test: a budget created with no ladder is governed by a point that blocks at 100
- [ ] 1.5 Test: a budget created with a warn-at-100 ladder is governed by a point that warns
- [ ] 1.6 Test: a request carrying `controlPolicy` is rejected with a 400
- [ ] 1.7 Test: passing a ladder when a control point already governs the budget mints nothing new (and settle the open question of whether that should instead be an error)

## 2. Remove the column

- [ ] 2.1 Drop `controlPolicy` from the `Budget` entity and from `budget.service.ts` create/update
- [ ] 2.2 Remove `budget.control_policy` from `erp_approval_system.dbml`, leaving the `control_policy` enum in place — `quota` and `work_location` both use it and are out of scope
- [ ] 2.3 Write the migration to drop only that column, with a comment recording that it must run after the control-point seed migration, which read this column to build the ladders
- [ ] 2.4 In `down`, recreate the column with its original `HARD_STOP` default, noting it cannot restore per-budget intent because that intent now lives in the control points
- [ ] 2.5 Update `seed/seed-data.ts` (three budgets set it) to express the same intent through the control point instead
- [ ] 2.6 Update `test/budget-fixture.ts`, which currently chooses the fixture's ladder from the policy
- [ ] 2.7 Verify a grep for `control_policy` still finds `quota` and `work_location` and no longer finds `budget`

## 3. Frontend

- [ ] 3.1 Remove `controlPolicy` from the shared Zod schemas in `shared/src/index.ts`
- [ ] 3.2 Remove the over-limit picker and its two default assignments from `BudgetFormView.vue`
- [ ] 3.3 Remove the now-unused i18n keys from `locales/{la,en,zh}`
- [ ] 3.4 Update the form specs that assert the policy round-trips
- [ ] 3.5 Test: neither the create nor the edit form shows an over-limit field, and saving sends none

## 4. Verification

- [ ] 4.1 Run the backend and front-end suites and both typechecks
- [ ] 4.2 Apply the migration against the local database and confirm the column is gone while `quota` and `work_location` keep theirs
- [ ] 4.3 Drive the running app: create a budget with no ladder and confirm from its detail that the governing control point blocks at 100
- [ ] 4.4 Record in design.md whichever answer review settles for the open question
