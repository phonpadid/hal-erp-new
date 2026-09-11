## 1. Shared schema — admit zero without loosening movements

- [x] 1.1 In `shared/src/index.ts`, add a non-negative decimal-string predicate alongside
      `isPositive` (same `POSITIVE_DECIMAL_STRING` shape, `>= 0`), and use it for
      `budgetCreateSchema.amountTotal` only. Leave `budgetTransferSchema.amount` on `isPositive`.
      (Adjustment intake has no shared schema — `BudgetDetailView.vue` validates it inline against
      the backend DTO, and is untouched by this change.)
- [x] 1.2 Give the amount refinement a message that survives translation — the current
      `A positive amount` string is rendered raw by the form and reads as English in a Lao UI.
- [x] 1.3 Unit-test the schemas directly: `budgetCreateSchema` accepts `"0"` and `"23056000"`,
      refuses `""`, `"-1"` and `"abc"`; `budgetTransferSchema` still refuses `"0"`. `shared` has no
      test runner of its own, so the test lives with the other shared-schema tests in
      `front-end/src/test/`.
- [x] 1.4 `pnpm --filter @erp/shared build` — the backend imports the CommonJS `dist` while vite
      aliases the TS source, so a stale build is how this lands green locally and broken on boot.

## 2. Budget form — accept zero and say what it means

- [x] 2.1 In `BudgetFormView.vue`, add the zero notice: rendered from the form's own amount value,
      stating that the line is recorded with no money and that spending is refused until the
      governing control point's ladder permits an overrun. Theme tokens, no hardcoded colour.
- [x] 2.2 Add i18n keys for the notice and the amount error in en/la/zh.
- [x] 2.3 Component test: entering `0` leaves the field valid (proved through the notice, which
      renders only in the field-error branch's `v-else`); entering `-1` shows a field error. The
      "one `propose` call" rule is already pinned at store level in `budget-plan-screens.spec.ts`
      and is a passthrough of whatever amount the resolver accepted, so it is not re-asserted here.
- [x] 2.4 Component test: the zero notice appears at `0` and is absent at a positive amount.

## 3. API client and store — the ladder update

- [x] 3.1 Add `updateControlPoint(id, { tolerance })` to `front-end/src/api/budgets.ts`, typed
      against `UpdateControlPointDto`.
- [x] 3.2 Add the store action: call it, then replace that row in `controlPointList` and
      `currentControlPoint` from the response. Do not reload the list.
- [x] 3.3 Store test: a successful update replaces the row in place and leaves paging and filters
      untouched; a failure leaves state unchanged and surfaces the server message.

## 4. Ladder editor component

- [x] 4.1 Build the dialog: add, remove and edit rungs (threshold percent + action), used by both
      the detail screen and the list.
- [x] 4.2 Label each action by what it does — `BLOCK` refuses at the threshold, `WARN` allows and
      records a warning — with i18n keys in en/la/zh.
- [x] 4.3 Client validation mirroring `ToleranceLadder.parse` and no further: refuse an empty
      ladder and a threshold that is empty, negative, or not a number. Do not sort, deduplicate, cap
      at 100, or reorder — send the rungs exactly as entered.
- [x] 4.4 Would-refuse-everything notice: when a `BLOCK` rung applied to the point's current ceiling
      lands at or below zero, state that no document may charge those budgets — including a
      backdated record of spending that already happened — and still allow the save.
- [x] 4.5 On refusal, keep the dialog open with the entered rungs and show the server's message.
- [x] 4.6 Component tests for 4.3, 4.4 and 4.5, plus: the request body preserves the entered order.

## 5. Wire it into both screens, permission-gated

- [x] 5.1 `ControlPointDetailView.vue`: offer the editor to `BUDGET_MANAGE` only; `BUDGET_VIEW`
      keeps today's read-only ladder display.
- [x] 5.2 `ControlPointListView.vue`: per-row edit affordance, same gate, same dialog.
- [x] 5.3 Tests: the affordance is absent for a `BUDGET_VIEW`-only user on both screens and present
      for a `BUDGET_MANAGE` holder; editing from a list row updates that row.

## 6. Verify against the running app

- [x] 6.1 Bring up the dev stack and propose a budget of `0` through the form end to end — the plan
      document is created and carries `amountTotal: "0"`.
- [x] 6.2 Changed control point `553200af` (node 6.111 · RCU) from `BLOCK` to `WARN` through the
      editor; the database now reads `[{"at":100,"action":"WARN"}]`. The would-refuse-everything
      notice could NOT be exercised against live data: that point's ceiling reports 23,056,000
      although its only ACTIVE budget is zero, because a REJECTED budget at the same node still
      counts toward the rollup — the defect this change deliberately excludes. The notice is
      covered by `tolerance-ladder-dialog.spec.ts` instead, and will be true on screen once that
      defect is fixed in its own change.
- [x] 6.3 Check `read_console_messages` after both flows — a Vue render error surfaces there and
      nowhere else.
- [x] 6.4 Screenshot both screens in light and dark mode; confirm no hardcoded colour and no
      untranslated string.

## 7. Close the loop

- [x] 7.1 `pnpm --filter front-end test` green (it covers the shared schemas too).
- [x] 7.2 Confirm no file under `back/src` changed — this change adds no endpoint, DTO, entity or
      migration, and a diff there means the scope slipped.
