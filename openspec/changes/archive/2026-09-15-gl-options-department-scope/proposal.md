## Why

The item registry's budget picker shows a department everyone's money.

On `/new/master-data`, the "ງົບປະມານ (ບໍລິສັດນີ້)" column lets whoever maintains the item registry
name the budget an item belongs to. The read behind it (`GET /budgets/gl-options`) returns every
`ACTIVE` budget of the company's open fiscal year, whatever the caller was granted. The IT staff
role holds `MASTER_MANAGE` at `DEPARTMENT` scope — and its four holders are offered ບໍລິຫານ's,
ບັນຊີ's and Procurement's budgets beside their own, and can bind an item to any of them.

The document-side picker (`GET /budgets/selectable`) already does the right thing: a
`DEPARTMENT`-scoped caller sees their own department's budgets plus the ones the company holds in
common (a node marked `is_shared`, inherited down the plan). The item-master read was written
before that rule existed and never caught up. This change applies the same rule to it, so that the
day a department is meant to draw on ບໍລິຫານ's money, marking that node as shared opens it in
BOTH pickers at once — no code, no second setting.

## What Changes

- `GET /budgets/gl-options` narrows by the caller's granted scope for `MASTER_VIEW` (the code the
  route is authorized by), the way the selectable read narrows by `DOC_CREATE`:
  - `DEPARTMENT` → the caller's own department's budgets PLUS every budget carried by a shared
    node. Shared widens; it never replaces.
  - `COMPANY` / `GROUP` → the whole company, as today.
- Each returned row says whether it is shared (`isShared`), so the picker can label money the
  company holds in common apart from money the department owns — the doc picker already does.
- The item registry's Select labels a shared budget as "ງົບກາງ", and stops mislabelling a row bound
  to a budget outside the caller's list as "not in the open fiscal year" (it IS in the year — it
  belongs to another department). Such a row stays readable and, for a caller who may not see that
  budget, stays as it is rather than being silently rebound.
- A department-scoped caller whose department holds no budget gets an empty message that says so,
  not one that says the fiscal year has no budgets.

Deliberately NOT in this change:

- **A per-department binding.** `item_company` stays unique on `(item_id, company_id)`: one budget
  per item per company. The binding's job is to stamp the account the item posts to; at document
  time the budget a line charges is resolved among the REQUESTER's own budgets on that account,
  so a binding made by IT does not put ບໍລິຫານ's spending on IT's budget. Making the binding
  per-department would be a schema change (a new column or table) for no behaviour the document
  side needs today.
- **Any change to who may bind.** `MASTER_MANAGE` still binds; the scope only decides which
  budgets are offered.

## Capabilities

Touches `budget-control` (the read) and, on screen only, `master-data` (the picker that consumes
it). Of the nine capabilities no other is affected.

### New Capabilities

(none)

### Modified Capabilities

- `budget-control`: "The Item Master Reads Budgets Well Enough To Name One" — the read is narrowed
  by the caller's `MASTER_VIEW` scope, widened by shared nodes, and each row states `isShared`.
  The existing scenarios (individual rows, `MASTER_VIEW` not `BUDGET_VIEW`, company isolation, no
  figures) stand unchanged.

Invariants checked: 1 (company isolation — the company filter is applied first and is never
replaced by the scope filter, exactly as in the selectable read); 5 (permission codes — the scope
is read off `MASTER_VIEW`, never off a role name); 7 (configuration over code — "which money is
common" is the `is_shared` mark, not a list in code). No ledger, balance, FX or approval rule is
touched.

## Impact

- `back/src/modules/budget/budget.service.ts` — `listGlOptions` gains the scope + shared filter
  (reusing `sharedNodeIds` and the `ScopeService` the selectable read already uses); `BudgetGlOption`
  gains `isShared`.
- `back/src/modules/budget/budget-gl-options.spec.ts` (new) — beside `budget-selectable.spec.ts`.
- `front-end/src/api/budgets.ts` — `BudgetGlOption.isShared`.
- `front-end/src/views/master/MasterDataView.vue` + `item-budget-gl-picker.spec.ts` — shared label,
  other-department label, empty message; `i18n/locales/{la,en,zh}/master.ts` — three strings.
- `openspec/specs/budget-control/spec.md` — delta below.
- No migration, no permission code, no DBML change. Callers holding `COMPANY`/`GROUP` scope see no
  difference.
