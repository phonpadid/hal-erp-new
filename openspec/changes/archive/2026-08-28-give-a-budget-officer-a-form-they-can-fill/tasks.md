## 1. The two reads

- [x] 1.1 A selectable-fiscal-years read on `BudgetService`: the active company's fiscal years,
      identifying fields only, scoped through `company` like every other budget read.
- [x] 1.2 A selectable-departments read: every ACTIVE department of the active company. Not
      `listFilterDepartments`, which returns only departments holding a budget — a department's
      first budget is what this form proposes.
- [x] 1.3 Both routed on the budget controller under `BUDGET_MANAGE`, declared before `:id` so the
      literal paths are not captured as a budget id.
- [x] 1.4 No schema change, no migration, no entity change — both are SELECTs over existing tables.

## 2. The form

- [x] 2.1 The create form reads its fiscal-year and department pickers from the two new endpoints;
      delete the `orgApi.fiscalYears.list` / `orgApi.departments.list` calls from its load.
- [x] 2.2 Gate the inline "new fiscal year" action on `FISCAL_YEAR_MANAGE` and "new department" on
      `DEPARTMENT_MANAGE` — the permissions their own POSTs require. Leave "new plan node" alone;
      it needs `BUDGET_MANAGE`, which whoever is on this form holds. **Already correct** — all three
      buttons were `v-can`-gated on exactly those codes. My diagnosis had said these would 403 too;
      they would not, because they are never offered. Kept as a task only to pin it with a test.
- [x] 2.3 Wrap the load so a failure renders the error state the other budget screens use, instead
      of abandoning `onMounted` and leaving every required picker empty with no message.
- [x] 2.4 Three locales for any new label. **None needed**: the error state shows the server's own
      message via `messageOf`, and its retry label already exists in `common`.

## 3. Tests

- [x] 3.1 Both reads return the active company's rows and nothing from another company.
- [x] 3.2 The department read includes a department that holds no budget — the case
      `filter-departments` deliberately excludes.
- [x] 3.3 Neither read returns a monetary field.
- [x] 3.4 Both are refused without `BUDGET_MANAGE`.
- [x] 3.5 The form populates its pickers for a user holding `BUDGET_MANAGE` and neither
      `FISCAL_YEAR_MANAGE` nor `DEPARTMENT_VIEW` — the regression that started this.
- [x] 3.6 The inline fiscal-year and department actions are hidden from that user, and the plan-node
      action is not.
- [x] 3.7 A failed load renders the error state rather than an empty form.
- [x] 3.8 The existing budget form, plan-screen and budget-read suites pass unchanged.

## 4. Verify against the user this started with

- [x] 4.1 Confirm `LATTANAPHONE` (`BUDGET_MANAGE`, no `FISCAL_YEAR_MANAGE`, no `DEPARTMENT_VIEW`)
      can open the create form and fill every required field. Do NOT propose a budget against the
      customer's data to prove it — reading the populated pickers is the assertion, and the
      end-to-end save is covered by the suites above.

      Verified, and split honestly between what the browser can show and what it cannot:

      - **Browser, admin session**: opening `/budgets/new` now issues
        `GET /budgets/selectable-fiscal-years`, `GET /budgets/selectable-departments` and
        `GET /budgets/nodes` — and NEITHER `/fiscal-years` nor `/departments`. The two reads that
        answered 403 are gone from the screen's traffic. No console errors.
      - **Real data confirms the second-read decision**: `filter-departments` returns 2 departments
        (the ones holding a budget); `selectable-departments` returns all 20 active ones. Reusing
        the filter read would have left **18 of the customer's 20 departments unbudgetable through
        the UI**. The department rows carry `id`, `deptCode`, `name` and nothing else.
      - **NOT done: logging in as LATTANAPHONE.** Their password is not ours to have and minting a
        token for them would be forging a credential. The permission half is proved instead by
        `budget-proposal-reads-gate.spec.ts`, which runs the REAL `PermissionsGuard` over the REAL
        controllers with their REAL 14-code grant set — a stronger check than a browser session,
        and one that runs on every commit.
      - **NOT provable in-page: the hidden buttons.** `v-can` applies on mount/update, so swapping
        `auth.permissions` in a live page does not re-hide anything. That gate is covered by
        `budget-form-needs-only-budget-manage.spec.ts`, which mounts with the restricted set — the
        path a real session actually takes.
