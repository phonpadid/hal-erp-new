## Why

The budget list offers a search box and nothing else. Measured on the customer's data today:

| | |
|---|---|
| budgets | **496** — 25 pages of 20 |
| departments holding one | **21** (ບໍລິຫານ 92, ການຕະຫຼາດ 59, ສູນຄັດແຍກ 35, ຂົນສົ່ງຕ່າງແດນ 28, ບຸກຄະລາກອນ 26, …) |
| statuses present | ACTIVE 478, **REJECTED 18** |
| control points | **474**, on a screen with the same toolbar |

The table shows a ພະແນກ column and a ສະຖານະ column. Neither can be used to narrow anything. A
department head who wants their own 59 budgets must either guess a word those budgets' names share
or page through all 25 pages, and the 18 REJECTED rows — proposals that were turned down — sit
mixed into the list with no way to set them aside.

Search does not answer this. Search is for finding *a* budget whose code or name you can partly
remember; a filter is for seeing *the set* you are responsible for. Free text cannot express
"mine", and a department name typed into the search box matches the budget's own name, not its
department.

`web-ui-quality` already requires that a control which appears to filter must filter the whole
list. This is the other half: the columns a reader is shown are the dimensions they will try to
narrow by, and offering neither control is why the search box gets asked to do a job it cannot.

## What Changes

**The budget list gains a department filter and a status filter, applied server-side.**
- 496 rows page on the server, so the filters go with the query — exactly as `search` already does.
  Filtering the loaded page would narrow 20 of 496 while looking like it narrowed all of them.
- They compose with each other and with `search`, and each resets the list to page 1.

**The department options come from a read gated on `BUDGET_VIEW`, not `DEPARTMENT_VIEW`.**
- `GET /departments` requires `DEPARTMENT_VIEW`. A department head with `BUDGET_VIEW` need not hold
  it, so sourcing the dropdown there would hand an empty filter to the very people it exists for.
- A new read returns the departments that actually hold a budget in the active company — the same
  reasoning `listSelectable` already applies to the budget picker, and a shorter, truer list than
  every department in the org.

**The control points screen gains the same two filters, applied on the client.**
- `BudgetControlPointService.list` is not paged: it returns every point, and its ceiling/used/
  available are already resolved for the whole set in a fixed number of queries. The screen holds
  all 474 rows, so client-side filtering is the correct implementation there — the same split
  `every-search-box-searches` settled for search.
- Its dimensions are the department NODE and `isActive`, which is what its rows carry.

**A filter states what it is hiding.**
- With a filter active the list says how many rows it is showing out of how many exist, so a reader
  cannot mistake a narrowed list for the whole one — the failure a filter introduces that a search
  box does not, because a filter can be left set and forgotten.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `budget-control`: the budget list read accepts an optional department and status filter, applied
  before the page window and within the active company's scope; and gains a read of the departments
  holding a budget, gated with the list itself.
- `web-ui-quality`: gains that a list showing a column readers narrow by SHALL offer a control for
  it, and that an active filter SHALL say what it is hiding.

## Impact

**Build-order capabilities touched:** `budget-control` only, and no behaviour changes — this adds
optional narrowing to an existing read. Company scope is unchanged and still applied first; a
filter narrows a scoped set and can never widen it.

**Invariants:** invariant 1 is the one at risk and is preserved by construction — the filters
`$and` onto the already-scoped `where`, as `withSearch` does, and the department read is scoped the
same way as the list it serves. Invariant 3 is untouched: no filter changes how a balance is
derived, and the control point figures stay resolved for the whole set before any narrowing.
No ledger, money or approval path is touched.

**Code**
- `back/src/modules/budget/budget.service.ts` — the two filters on `list`, plus
  `listFilterDepartments`.
- `back/src/modules/budget/budget.controller.ts` + DTO — the query parameters, validated.
- `front-end/src/views/budgets/BudgetListView.vue` and `ControlPointListView.vue` — a `#filters`
  slot on the toolbar each, as seventeen other screens already have.
- `front-end/src/stores/budgets.ts` and `api/budgets.ts` — carry the filters, reset to page 1.

**Data:** none. No migration, no column, no backfill.

**Not in scope:** a fiscal-year filter — the customer's data holds exactly one year (2026), so the
control would be a dropdown with one option; it becomes worth adding the moment a second year is
loaded, and the shape here leaves room for it. Also out of scope: filtering by amount or by
available balance, saved filter presets, and the budget screen's tree mode, whose own full load is
a separate read.
