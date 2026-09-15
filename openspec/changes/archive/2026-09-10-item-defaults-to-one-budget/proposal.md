## Why

An item's per-company default is stored as `item_company.default_gl_account`, so the item registry
can only say which **account** an item posts to — never which **budget** it belongs to. One account
carries many budgets: at HAL Logistic, `612.06` is the account of 6.101 ຄ່າເຊົ່າ ເຊີເວີ HAL Express,
6.102 AMAZON Web Services, 6.103 PubNub and 6.107 Mail Express. An admin who wants "Mail Express"
against an item has no way to record it, because all four choices save the same eight characters.

The screen already asks in budgets (that is how an admin recognises the money), but with nothing
narrower than an account to store, it has to fold those four budgets into one option — which is what
the customer reported: four budgets, one line, no way to bind the one they meant.

## What Changes

- `item_company` gains the budget an item defaults to, recorded as the budget's place **in the plan**
  — the plan code (`6.101`) — not the `budget.id`. `budget` and `budget_node` are both keyed by
  fiscal year, so a stored id would point at a closed year's row every time a new year opens; a plan
  code keeps meaning the same budget across years, because `budget_node` is unique on
  `(fiscal_year_id, code)` and `budget.node_id` is unique.
- The item picker offers **one row per budget** and records exactly the one clicked. Several budgets
  sharing an account become several options with different outcomes, as the admin expects.
- `item_company.default_gl_account` stays, and stays the account documents and journal entries read.
  It is no longer asked for on its own: it is **stamped from the bound budget** when the binding is
  set. Nothing in the document engine or GL posting changes.
- An item bound to a budget the open year does not have (a plan code retired at year-end) keeps its
  stamped account and posts as before; the screen shows the binding and says it is not in the open
  year, rather than silently reading as unset.
- `GET /budgets/gl-options` already returns what identifies a budget individually — plan code,
  budget name, department name, account. What changes is the caller: it stops folding those rows
  together by account.
- **Existing rows keep working.** An item that carries only a `default_gl_account` is left exactly as
  it is: unbound, still posting to its account. Nothing is back-filled, because an account cannot be
  turned into one of the four budgets that share it — that is the very ambiguity this change removes.
- Corrects spec drift: `master-data` and `web-master-data` still require the item GL to be picked
  from the company's postable accounts, while the shipped screen picks by budget.

## Capabilities

### New Capabilities

None. This narrows an attribute two existing capabilities already own.

### Modified Capabilities

- `master-data`: the per-company item default is a **budget** (its plan code), resolved to the open
  fiscal year; its GL account is derived from that budget rather than set by hand, and is still
  validated against the active company's chart.
- `web-master-data`: the item registry's per-company column picks one budget from a flat list
  (budget name, department, plan code) and shows the bound budget by its own name.
- `budget-control`: `gl-options` is specified as identifying each budget individually (one row per
  budget, carrying its plan code), so a caller can name one budget rather than a set of them. Also
  corrects `budget_node` in the DBML, which still shows a `department_id` and a three-column unique
  key the entity and the database have never had.

## Impact

- **Data model** (`erp_approval_system.dbml`): one nullable column on `item_company`
  (`default_budget_code`). Additive migration; no back-fill; no column dropped. Separately, the
  stale `budget_node` block is corrected to the shape the entity and database actually have.
- **Backend**: `ItemCompany` entity; `EnableItemDto`; `ItemService.enableForCompany` (resolve the
  budget, stamp the account) and its list projection; `BudgetService.listGlOptions`.
- **Untouched**: `document.service.resolveLineAccount`, `document-submit.service` and
  `gl-posting.service` keep reading `item_company.default_gl_account`. Budget reservation still
  charges the budget the **document line** names — this binding is a default for the registry, not a
  new way to charge money.
- **Frontend**: `MasterDataView.vue` items tab, `api/masterData.ts` + store (the bound budget on
  each item row), `master.item.*` strings in `en` / `la` / `zh`.
- **Invariants**: company isolation holds because a code is only ever resolved inside the active
  company's open fiscal year, which is company-scoped (invariant 1); the budget is resolved
  server-side and is not requester-editable; no ledger, no reservation and no FX behaviour is
  touched, so invariants 2-4 and 6 are not in play.
