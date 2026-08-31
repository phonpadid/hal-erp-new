## Why

The budget picker offers a requester their own department's budgets and nothing else. On the
customer's data that is wrong for almost everybody.

`LATTANAPHONE` is the budget officer, in `ພະແນກງົບປະມານ` (BG). BG holds no budget and never will —
a budget department administers the plan, it does not spend it. Their job is to key FY2026's
spending history for the whole company, which is why `DOC_BACKDATE` exists at all. The picker asks
`selectable(departmentId = BG)`, gets an empty list, and no `requires_budget` document can be
submitted. Nothing errors; the picker is simply empty.

Their grants already say otherwise:

```
ພະແນກງົບປະມານ | DOC_CREATE   | COMPANY
ພະແນກງົບປະມານ | DOC_BACKDATE | COMPANY
ພະນັກງານ      | DOC_CREATE   | DEPARTMENT
```

`Scope` and `ScopeService.scopeWhere` exist, are implemented, and are configured correctly for this
user. `listSelectable` never consults either — it takes a `departmentId` the client fills from
`auth.departmentId`, hardcoding DEPARTMENT behaviour for everyone however widely they were granted.

The second half is not about the user at all. Much of the plan is money the whole company draws on:

```
1  ພະແນກ ບໍລິຫານ
├── 1.100 ຄ່າບໍລິຫານ ທົວໄປ        office supplies · cleaning · drinking water · subsidies
└── 1.400 ລາຍຈ່າຍປະຈຳເດືອນ       security at HQ and the sorting centre · Synergy · phones · cleaners
```

Those budgets are held by `ບໍລິຫານ`, and marketing pays for its own phones out of them. An ordinary
employee holding `DOC_CREATE` at `DEPARTMENT` is correctly scoped and still cannot reach them, so
scope alone does not fix this. Whether a budget is shared is a property of the BUDGET, not of the
person spending.

Nothing in the system disagrees. The server's submit validates only that a line's budget is
`ACTIVE`; no code compares `document.department_id` with `budget.department_id`. A control point
governs a budget through *that budget's* department, never the document's. And `spend-plan.ts`
already recorded the finding on real data: *"the department column says who spent, and 16 rows show
the two are not the same question."* Three places model "who spends" and "whose budget" as separate;
one screen assumes they are the same, and that screen is the one people use.

## What Changes

- The selectable-budgets read SHALL answer according to the caller's granted `Scope` for
  `DOC_CREATE` rather than a department the client chooses: `DEPARTMENT` sees its own department's
  budgets, `COMPANY` sees the active company's.
- A `budget_node` MAY be marked as carrying shared budget. Every budget under that node — the node
  itself or any descendant — SHALL be offerable to every department, whatever the caller's scope.
- The picker SHALL show which budgets are its own department's and which are shared, so a requester
  charging shared money knows that is what they are doing.
- Marking a node SHALL require `BUDGET_MANAGE` and SHALL be done where the plan tree is already
  shown, not on the document form.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `budget-control`: "Selectable Budgets for Document Creation" gains the scope rule and the shared
  subtree; a new requirement covers what marking a node means and who may do it.
- `web-budgets`: the plan tree gains the affordance for marking a node as shared.
- `web-documents`: the line's budget picker offers shared budgets alongside the department's own and
  distinguishes them.

## Impact

- **Capabilities touched**: `budget-control` (the read + the node flag), `web-budgets` (the tree
  affordance), `web-documents` (the picker). `rbac` is read from, not changed — no permission code
  is added or re-assigned, and no role needs re-granting.
- **Schema**: one nullable-defaulted boolean on `budget_node`, plus a migration. The DBML must be
  updated with it.
- **DBML drift found while scoping this**: `erp_approval_system.dbml` still gives `budget_node` a
  `department_id [not null]` and keys it `(fiscal_year_id, department_id, code)`, while the entity
  deliberately carries no department and keys `(fiscal_year, code)` — *"A node carries NO
  department, deliberately."* The two disagree today, before this change. Reconciling that is not
  this change's job, but a column cannot be added to a table whose definition is already wrong
  without saying so.
- **Invariant risk**:
  - INVARIANT 1 (company isolation): a `COMPANY`-scope caller now sees more budgets than before.
    Every one must still be scoped through `fiscalYear.company`; scope widens the DEPARTMENT filter
    and must never replace the company filter.
  - INVARIANT 5 (permission codes, not role names): the widening is decided by the granted scope of
    `DOC_CREATE`, never by a role name and never by the department's name.
  - INVARIANT 3 (derived balances): untouched. This is a read; it returns no amount, as that read
    already promises.
- **Ledger**: nothing here writes `budget_txn`. Reserving still happens at submit, unchanged.
- **Code**: `BudgetService.listSelectable`, the budgets controller, `BudgetNode`, a migration, the
  budget list's tree view, and the wizard's budget picker.
- **Not in scope — per-department ceilings on a shared budget.** A control point is keyed on the
  budget's own department, so "the welfare budget is 100M and marketing may draw 20M of it" cannot
  be expressed. Shared budgets make that question askable for the first time; it needs its own
  change, and inventing a second ceiling mechanism in passing would be worse than not having one.
- **Not in scope — reporting attribution.** When marketing charges a shared budget, spend-by-
  department reports must decide whether that is marketing's spend or `ບໍລິຫານ`'s. `budget_txn`
  carries `document_id`, so the answer is derivable whenever it is settled; it is not settled here.
- **Not in scope — plan roots that are not departments.** Six of the plan's twenty roots are expense
  categories or projects (`ລາຍຈ່າຍ ຄ່າຂົນສົ່ງ`, `ສ່ວນແບ່ງ ຕ່າງໆ`, `ຮຸ້ນສ່ວນ`, `ພັດທະນາ HAL PAY`,
  `ໂຄງການຂົນສົ່ງ ຕ່າງແດນຕ່າງໆ`, and the contingency roots), yet `departmentOf` derives a department
  from the code's first segment, so their budgets are attributed to departments that do not exist.
  Marking those roots shared would hide the symptom rather than answer who owns them. Named here so
  it is not rediscovered.
