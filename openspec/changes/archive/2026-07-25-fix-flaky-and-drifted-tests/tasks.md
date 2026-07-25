## 1. Reproduce the failures first

- [x] 1.1 Run `pnpm --filter back test` and confirm the reported failure is
  `leave-request.service.spec.ts > refuses a request filed with too little notice, reserving
  nothing`, throwing `This request covers no working days` instead of the expected
  `/at least .* day/`. Note the weekday of the run — on Monday–Thursday and Sunday this test
  passes and there is nothing to reproduce; wait for or simulate a Friday/Saturday run before
  claiming the fix works.
- [x] 1.2 Run `pnpm --filter front-end test` and confirm `72 passed / 621 passed` alongside
  `Errors 3` and a non-zero exit, with `budgetsApi.movementDocTypes is not a function` and
  `Cannot read properties of null (reading 'insertBefore')` among them.

## 2. Backend: the date that means something different every day

- [x] 2.1 Add a `nextWorkingDate()` helper to
  `back/src/modules/attendance/leave-request.service.spec.ts`, beside the `MON`…`SUN` constants,
  returning the next Monday–Friday date after today as `YYYY-MM-DD`, with a comment stating why
  "tomorrow" is not a safe choice for a spec that charges working days.
- [x] 2.2 Replace the `new Date(Date.now() + 86_400_000)` line in *"refuses a request filed with
  too little notice, reserving nothing"* with that helper, leaving `advanceNoticeDays: 3650` and
  every assertion — including the `QuotaUsage` zero-rows check — unchanged.
- [x] 2.3 Run that single spec file and confirm it passes today; the failure in 1.1 is the
  control, so a green run on the same weekday is the evidence the weekend dependency is gone.
- [x] 2.4 Run the full `pnpm --filter back test` and confirm `0 failed`, with the same
  `1074 passed` and 36 `verify-dev-*` tests still skipped — un-skipping them is not part of this
  change.

## 3. Frontend: the mock narrower than its surface

- [x] 3.1 In `front-end/src/views/budgets/waterfall.spec.ts`, build the mocked `budgetsApi` by
  spreading the real one from the already-awaited actual module, then overriding only `get`,
  `breakdown`, and `ledger`, so `movementDocTypes` and any member added later resolve rather
  than being `undefined`.
- [x] 3.2 Run that spec file alone and confirm no `Unhandled Rejection` is reported and both
  waterfall-gating tests still pass.

## 4. Frontend: the teardown that removes the ground

- [x] 4.1 In `front-end/src/components/master-data/VendorBankAccountsPanel.spec.ts`, unmount each
  mounted wrapper after every test — `enableAutoUnmount(afterEach)` from `@vue/test-utils`, or an
  explicit `afterEach` over tracked wrappers — so teleported dialogs leave with their component.
- [x] 4.2 Remove the `document.body.innerHTML = ''` line from `beforeEach` together with its
  now-stale comment.
- [x] 4.3 Run that spec file alone and confirm every test still passes, paying attention to the
  ones asserting on `document` after opening a dialog; if one now fails, it was relying on a
  previous test's leftovers and the test — not the teardown — is what needs fixing.

## 5. Frontend: the typecheck that fails before the tests run

Found while running task 5.1: `pnpm run ci` is `typecheck && test`, and the typecheck half fails
on four errors in files this change did not originally touch. `StockOnHandView.vue` and both
tsconfigs are byte-identical to `master`, so this predates the branch — and it means
`pnpm --filter front-end build`, which the deploy workflow runs as `vue-tsc -b && vite build`,
cannot reach `vite build` either. Scope extended deliberately: the whole point of the change is a
signal that can gate a deploy, and a gate that never gets past typecheck gates nothing.

- [x] 5.4 Remove the unused `vi` import from `front-end/src/views/attendance/attendance-hr.spec.ts`.
- [x] 5.5 Remove the unused `const { t } = useI18n()` binding and its now-unused `vue-i18n` import
  from `front-end/src/views/inventory/StockOnHandView.vue`; the template already resolves its text
  through the global `$t`, so nothing rendered changes.
- [x] 5.6 Turn `TeamDayFilters` and `PunchFilters` in `front-end/src/api/attendanceHr.ts` from
  interfaces into type aliases, so they carry the implicit index signature that
  `dropEmpty<T extends Record<string, unknown>>` requires, with a comment saying why the
  distinction matters. Type-level only — no call site or request shape changes.
- [x] 5.7 Run `pnpm --filter front-end run typecheck` and confirm it exits zero.

## 6. Prove the suites are trustworthy

- [x] 6.1 Run `pnpm --filter front-end run ci` (typecheck + tests) and confirm it exits zero with
  no errors reported.
- [x] 6.2 Run `pnpm --filter back test` once more end to end and confirm zero failures.
- [x] 6.3 Re-read the two delta specs and confirm each scenario now describes something the
  repaired suites actually do, then update `openspec/specs/platform-foundation/spec.md` and
  `openspec/specs/web-ui-quality/spec.md` through `/opsx:archive` rather than by hand.
