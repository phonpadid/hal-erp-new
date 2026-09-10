## 1. Data model and migration

- [x] 1.1 Add `default_budget_code varchar` (nullable) to `Table item_company` in
      `erp_approval_system.dbml`, noting that it names the budget's place in the plan (not
      `budget.id`, which is per fiscal year) and that `default_gl_account` is stamped from the budget
      it resolves to. Correct the stale `budget_node` block while there: it shows a `department_id`
      and a `(fiscal_year_id, department_id, code)` key the entity and the database do not have.
- [x] 1.2 Add `defaultBudgetCode` to `ItemCompany` in
      `back/src/modules/master-data/master-data.entities.ts` (`@Property({ nullable: true })`), with a
      comment carrying the reason from design decision 1.
- [x] 1.3 Write `back/src/migrations/Migration<timestamp>.ts` adding the column — a varchar, not a
      foreign key, since the row a code names differs each year. No back-fill (design decision: an
      account cannot be resolved back to one of the budgets that share it). Run it against the local
      DB (`DB_PORT=5433`) and confirm existing `item_company` rows are untouched.

## 2. The budget read that names one budget

- [x] 2.1 Leave `BudgetService.listGlOptions` (`back/src/modules/budget/budget.service.ts`) returning
      one row per budget and no figures — the plan code on each row already names one budget. Update
      the doc comment, which still explains the read as feeding an account picker.
- [x] 2.2 Unit test in `back/src/modules/budget/`: budgets of the open year sharing one `gl_account`
      come back as separate rows, each with its own plan code and budget name; another company's
      budgets never appear.

## 3. Item enablement resolves and stamps

- [x] 3.1 Add a resolver owned by the budget module (`back/src/modules/budget/`): given a plan code,
      find the `budget_node` of the active company's OPEN fiscal year (same open-year resolution
      `BudgetController.defaultFiscalYearId` uses) and the `budget` on that node. Reject when it
      resolves to nothing or when the budget's `status` is not `ACTIVE`.
- [x] 3.2 Change `ItemService.enableForCompany` to take the binding instead of a client-supplied
      account: when a plan code is given, resolve it, write `defaultBudgetCode`, and stamp
      `defaultGlAccount` from the resolved budget's `gl_account` (still validated through
      `AccountService.resolvePostable`). Clearing the binding nulls the code and leaves the stamped
      account in place. One `flush()` writes binding and stamp together.
- [x] 3.3 Extend `EnabledItem` and `ItemService.listEnabled` with `defaultBudgetCode` and the
      resolved budget's name (null when the open year does not carry it), omitted under GROUP scope
      like `defaultGlAccount` already is.
- [x] 3.4 Replace `defaultGlAccount` on `EnableItemDto` (`back/src/modules/master-data/dto/item.dto.ts`)
      with `defaultBudgetCode` (`@IsOptional @IsString @MaxLength`); update the
      `POST /items/:id/enable` handler in `item.controller.ts` to pass it.
- [x] 3.5 Unit tests in `back/src/modules/master-data/`: binding one of four budgets on a shared
      account records that budget alone; the account is stamped from it; a code naming no budget of
      the open year is rejected; another company's code is rejected (invariant 1); a binding resolves
      in a NEW fiscal year carrying the same code with no write to `item_company`; an item holding
      only an account keeps posting and stays unbound.

## 4. Document engine stays put

- [x] 4.1 No change to `document.service.resolveLineAccount`, `document-submit.service` or
      `gl-posting.service`. Run their existing suites to confirm the stamped account still answers
      every read they make.

## 5. The registry screen picks one budget

- [x] 5.1 Add the binding fields to the item type in `front-end/src/api/masterData.ts`.
- [x] 5.2 Rewrite the items-tab picker in `front-end/src/views/master/MasterDataView.vue`: a FLAT
      list, one row per budget (name, department, plan code + account), single selection keyed by the
      plan code, no grouping and no "N budgets" summary. The chosen budget shows by its own
      name; a binding the open year does not carry stays visible, marked as outside the open year;
      an item carrying only an account shows that account. Read-only without `MASTER_MANAGE`.
- [x] 5.3 Update `setItemGl`/`setItemEnabled` in `front-end/src/stores/masterData.ts` to send the
      plan code (and to clear it), never an account.
- [x] 5.4 Replace the `master.item.gl*` strings in `front-end/src/i18n/locales/{en,la,zh}/master.ts`:
      drop `glBudgetCount`, keep a placeholder/filter/empty string, and add one for a binding outside
      the open fiscal year.
- [x] 5.5 Rewrite `front-end/src/views/master/item-budget-gl-picker.spec.ts` for the new shape: four
      budgets on one account are four selectable rows; picking `6.107` sends that department + code;
      the row then reads `Mail Express`; a binding outside the open year stays visible on its own row
      only; no picker without `MASTER_MANAGE`.

## 6. Verify

- [x] 6.1 `openspec/specs/master-data/spec.md` and `web-master-data/spec.md` no longer say the item
      GL is picked from the postable-account chart (handled by archiving this change's deltas).
- [x] 6.2 Run the touched backend suites, the frontend unit suites and `vue-tsc --noEmit`.
- [x] 6.3 Check the real screen at `/new/master-data` against the HAL data: 612.06's four budgets are
      four separate rows, and the item bound to 6.101 reads `ຄ່າເຊົ່າ ເຊີເວີ HAL Express`.
      Verified by the user on the shared TEST server after it deployed `d6b5691`, not locally — the
      local `:5433` database holds five budgets and none of these codes, and `front-end/.env.local`
      points at that server. Until the deploy, a save was refused with
      `property defaultBudgetCode should not exist` (400), which is what proved the two halves were
      on different versions rather than the feature being wrong.
