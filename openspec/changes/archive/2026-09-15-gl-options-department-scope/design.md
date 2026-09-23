## Context

Two reads offer budgets to a picker, and they disagree about who may see what.

`BudgetService.listSelectable` (the document line's budget picker, `GET /budgets/selectable`) reads
the caller's granted scope for `DOC_CREATE`: `DEPARTMENT` pins the list to
`budget.department_id = the caller's department` OR `budget.node_id ∈ shared`, where "shared" is
every node marked `budget_node.is_shared` and everything beneath one (`sharedNodeIds`, inheritance
applied). `COMPANY`/`GROUP` add nothing beyond the company filter. This is specified, tested
(`selectable-follows-the-grant.spec.ts`) and in production.

`BudgetService.listGlOptions` (the item registry's budget picker, `GET /budgets/gl-options`) predates
that rule. It filters by company, open fiscal year, `status = ACTIVE` and `gl_account IS NOT NULL`,
and stops there. On the customer's data the IT staff role holds `MASTER_MANAGE` at `DEPARTMENT` and
its holders are offered — and can bind items to — every department's budgets.

The consumer, `MasterDataView.vue`, renders whatever it gets: one option per budget, filterable by
name / code / department / account, plus a synthetic option when a row's stored code is not among the
options (today that can only mean "retired at year-end", and it is labelled so).

The frontend's auth store keeps permission CODES only, not the scope each was granted at.

## Goals / Non-Goals

**Goals:**

- One rule for "which budgets may this caller pick", applied by both pickers, so marking a node as
  shared opens it in both at once.
- A row bound to a budget the caller may not see stays legible and is not silently rebound.
- No schema, permission-code or migration change.

**Non-Goals:**

- A per-department item binding. `item_company` stays `(item_id, company_id)`-unique.
- Changing who may bind (`MASTER_MANAGE`), or the route's guard (`MASTER_VIEW`).
- Teaching the frontend the scope of a grant. Not needed here (see D4), and a wider change.
- Filtering the ITEM list by department. Items are company master data; every registrar sees them.

## Decisions

### D1 — The scope is read off `MASTER_VIEW`, the code the route is guarded by

`listSelectable` keys on `DOC_CREATE` because that is what `GET /budgets/selectable` is authorized
by; `ItemService.listEnabled` keys on `MASTER_VIEW` for the same reason. The rule is "the grant that
admitted the caller decides how much they see", and `gl-options` is admitted by `MASTER_VIEW`.

*Alternative rejected:* keying on `MASTER_MANAGE`, the code that performs the binding. It is not
what the route checks, so a `MASTER_VIEW`-only caller (who the route admits) would fall through
`scopeFor` to `undefined`, and the read would need a second rule for that case. On the customer's
roles VIEW and MANAGE are granted at the same scope anyway, so the two choices give the same list;
the guard's code is the one with a single answer for every admitted caller.

`scopeFor` returns `undefined` for an ungranted code; the guard has already refused such a caller,
so — as `listSelectable` does — only the `=== DEPARTMENT` half is read and anything else means "no
department filter".

### D2 — One helper builds the department-or-shared filter for both reads

Today `listSelectable` builds the `$or` inline. Extract it into a private
`departmentOrSharedWhere(code, em)` on `BudgetService` that loads the company's nodes
(`FILTER_OFF`, `fields: ['parent', 'isShared']`), computes `sharedNodeIds`, and returns
`{ where: FilterQuery<Budget> | undefined, shared: Set<string> }`. Both reads apply `where` when
present and use `shared` to mark rows. One shape, computed one way, so the two pickers cannot
drift — the same reasoning `sharedNodeIds` gives for itself against `budget-control`.

The `departmentId` FILTER `listSelectable` accepts (narrowing within scope for a `COMPANY` caller) is
not added to `gl-options`; the registry has no such control and a parameter nobody sends is a
surface to keep honest for nothing.

### D3 — `isShared` travels on `BudgetGlOption`

The doc picker groups shared budgets under "ງົບກາງ" so a requester can tell common money from their
own before charging it. The registry needs the same distinction for the same reason, and the set is
already in hand from D2. Added as a required boolean (never absent): "not shared" is a fact, not a
missing value.

### D4 — The frontend distinguishes "another department's budget" from "not in the open year" by
what the server already returns, not by learning the scope

`ItemService.listEnabled` resolves every row's `defaultBudgetName` company-wide
(`budgetsByPlanCode` on the open year), independent of the picker's list. So for a row whose stored
code is not among the options:

| `defaultBudgetName` | code in options | meaning | synthetic option label |
|---|---|---|---|
| absent | no | code retired at year-end (today's case) | `{code} (ບໍ່ມີໃນປີງົບທີ່ເປີດຢູ່)` — unchanged |
| present | no | budget exists, caller may not see it | `{name} (ງົບຂອງພະແນກອື່ນ)` — new |
| — | yes | normal | the option itself |

The synthetic option stays in the list so the Select renders the stored value; picking anything else
is an explicit act and goes through the same `setItemBudget`. Nothing rebinds on its own.

*Alternative rejected:* having the frontend read the grant's scope from the auth store. The store
does not carry scope; adding it is a real change to the session model for one label the server
already lets us derive.

### D5 — One empty message that is true under every scope

The Select's empty message today says the open fiscal year has no budgets. Under D1 an empty list
can also mean "your department holds none and nothing is shared", and the frontend cannot tell which
(D4). Rather than guess, the message is reworded to what is true in both cases: there is no budget
this caller may bind to in the open fiscal year (`master.item.budgetEmpty`, la/en/zh).

## Risks / Trade-offs

- [A department-scoped registrar can no longer see a binding another department made, except as
  "another department's budget"] → That is the point; the binding still stamps the account, and the
  document side resolves the budget among the requester's own. Documented in the proposal's
  non-goals; the label (D4) keeps the row honest.
- [A caller in no department (`RequestContext.departmentId()` empty) at `DEPARTMENT` scope sees only
  shared budgets] → Same as `listSelectable` today; a `$or` on an empty department matches nothing
  of it, and the shared half still applies. D5's message covers the empty case.
- [Extracting the helper touches `listSelectable`] → `selectable-follows-the-grant.spec.ts` and
  `budget-selectable.spec.ts` pin its behaviour; the refactor is done under them, unchanged.
- [`MasterDataView`'s `filterFields` include `departmentName`] → Still useful under `COMPANY` scope;
  under `DEPARTMENT` scope it simply matches the caller's own department, harmless.

No `budget_txn` or `quota_usage` is written by this change; both reads are projections with no
transaction or locking concern.

## Migration Plan

Deploy backend then frontend, or together; an old frontend against the new backend just ignores
`isShared` and shows a narrower list, which is the intended behaviour. No data migration. Rollback is
a code revert.

## Open Questions

None blocking. Whether ບໍລິຫານ's plan node should be marked shared for the customer is a
configuration decision for their `BUDGET_MANAGE` holder, not part of this change.
