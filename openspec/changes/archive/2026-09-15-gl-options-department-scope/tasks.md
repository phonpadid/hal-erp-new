## 1. Backend — one rule for both pickers

- [x] 1.1 `BudgetService`: extract the department-or-shared filter `listSelectable` builds inline
      into a private helper (design D2) that returns the `where` fragment (or none for
      `COMPANY`/`GROUP`) and the shared node set, keyed on the permission code passed in.
      `listSelectable` keeps calling it with `DOC_CREATE`; its behaviour and its existing specs
      stay unchanged.
- [x] 1.2 `listGlOptions`: apply the helper with `MasterP.MASTER_VIEW` (design D1) AFTER the company
      / fiscal-year filter, never in its place; keep `status = ACTIVE` and `gl_account IS NOT NULL`.
- [x] 1.3 `BudgetGlOption`: add `isShared: boolean` from the helper's shared set, and update the
      interface doc to say what it is for.

## 2. Backend tests

- [x] 2.1 New `back/src/modules/budget/gl-options-follow-the-grant.spec.ts`, modelled on
      `selectable-follows-the-grant.spec.ts`: a `DEPARTMENT`-scoped `MASTER_VIEW` caller sees only
      their own department's budgets; a shared node's budgets reach them marked `isShared`, beside
      their own which are not; shared widens rather than replaces; a `COMPANY`-scoped caller sees
      every department; a shared node in company B never reaches company A; a caller in a
      budget-less department with nothing shared gets an empty list, not a refusal.
- [x] 2.2 `budget-selectable.spec.ts` and `selectable-follows-the-grant.spec.ts` still pass unchanged
      after the extraction (1.1) — the refactor is done under them.

## 3. Frontend — the registry's picker

- [x] 3.1 `front-end/src/api/budgets.ts`: `BudgetGlOption.isShared: boolean`.
- [x] 3.2 `MasterDataView.vue`: carry `isShared` into `budgetChoices`; in the option template mark a
      shared budget with the same "ງົບກາງ" wording the document picker uses
      (`documents.create.line.budgetShared`, or a `master.item.budgetShared` key if the wording
      must differ), so common money reads apart from the department's own.
- [x] 3.3 `budgetChoicesFor` (design D4): when the row's stored code is not among the options, label
      the synthetic option `{name} (ງົບຂອງພະແນກອື່ນ)` if the server resolved a `defaultBudgetName`
      for it, and keep `{code} (ບໍ່ມີໃນປີງົບທີ່ເປີດຢູ່)` when it did not. The function now takes the
      row, not just the code.
- [x] 3.4 i18n `la/en/zh/master.ts`: add `budgetOtherDepartment` and (if 3.2 needs it)
      `budgetShared`; reword `budgetEmpty` to "no budget you may bind to in the open fiscal year"
      (design D5).

## 4. Frontend tests

- [x] 4.1 `item-budget-gl-picker.spec.ts`: a shared option is labelled as such; a row bound to a
      budget outside the list but resolved by name shows the other-department label, keeps its
      value, and is not rebound until the user picks; the retired-code case still shows the
      outside-year label.

## 5. Verification

- [x] 5.1 `DB_PORT=5433 DB_NAME=erp_test pnpm -C back test` (under `nvm use`) and
      `pnpm -C front-end test`; `tsc -p tsconfig.build.json` in `back/`, `vue-tsc -b` in `front-end/`.
- [x] 5.2 On the local `erp` DB: sign in as an IT staff user (`MASTER_MANAGE` at `DEPARTMENT`) and
      confirm `/new/master-data` offers only IT's budget; as `Administrator` (`COMPANY`) confirm all
      five; mark ບໍລິຫານ's node shared on `/new/budgets` and confirm it appears for the IT user
      labelled ງົບກາງ, then unmark it.
