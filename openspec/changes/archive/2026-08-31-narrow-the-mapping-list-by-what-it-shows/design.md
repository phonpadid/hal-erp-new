## Context

`DeptDocTypeService.listForCompany` pages server-side and already narrows by a search term:

```
withSearch<DeptDocType>(
  { department: { company: companyId } },   // the scope
  q.search,
  ['department.name', 'documentType.code'],
)
```

`withSearch` carries the property this change depends on, and says so where it is defined:

> *"NARROWS, never replaces. The `where` handed in is the one the caller already scoped by company
> (invariant 1)… so a search term cannot reach a row that scope excluded. That is what makes the
> same helper safe across every list endpoint instead of each one arguing the point separately."*

The filters must compose the same way, for the same reason.

The precedent is `narrow-a-budget-list-to-what-you-own`, which added a department filter and a
status filter to the budget list. Its DTO records a decision worth reusing here:

> *"Both filters are optional and NEITHER has a default. Defaulting `status` to ACTIVE would hide
> the [rejected rows] … `status` is validated against the declared list rather than accepted as any
> string."*

## Goals / Non-Goals

**Goals:**

- An administrator can ask "which types may this department raise" and get exactly that.
- A filter narrows the whole list, not the page the client is holding.
- A narrowed list cannot be mistaken for the whole one.

**Non-Goals:**

- A workflow filter. Two workflows over eighty rows separates them into two heaps and answers
  nothing anybody is asking.
- Answering "which types is this department NOT mapped to". That is about rows which do not exist,
  and no filter over existing rows can produce them.
- Changing what the screen can edit, or the permission it sits behind.

## Decisions

### The filters go to the server, beside the search

Three optional query parameters on the existing read. Applied by `$and`-ing onto the same
company-scoped `where` that `withSearch` narrows.

*Alternative considered — filter the loaded page on the client.* Rejected on the rule
`web-ui-quality` already carries and this screen already obeys for search: with 80 rows over four
pages, a client-side filter would narrow 20 of them while presenting itself as having narrowed all
80. The comment in `DeptMappingsView` says exactly this about the bindings it replaced — *"they were
decoration, and a client-side filter would have been wrong regardless"* — and adding one back would
undo that.

### Each filter narrows; none defaults

No filter is applied unless the reader picks one, and `isActive` in particular does not default to
true. A screen that silently hides the deactivated mappings is a screen that cannot be used to find
out why a department lost a document type — which is one of the two questions it exists for.

### `isActive` is a tri-state, not a checkbox

Unset (everything), active, inactive — because "show me the deactivated ones" is the question worth
asking, and a checkbox can only express two of the three.

### The department options come from the mappings, not the directory

The same reasoning `BudgetService.listFilterDepartments` records, and the same reasoning that put
`GET /budgets/selectable-departments` on the budget side yesterday: `GET /departments` requires
`DEPARTMENT_VIEW`, which a `DOC_CONFIG_MANAGE` holder need not have, so sourcing the dropdown there
would hand an empty filter to exactly the administrator it is for.

The document-type options have no such problem — the doc-config screens already read the type list
under the same permission — so those come from where they already come from.

*Alternative considered — offer every department in the company.* Rejected: a filter must never
offer an option that yields nothing, and a department with no mapping yields nothing here. (Note
this is the OPPOSITE of the call made for the budget proposal form yesterday, and deliberately so:
that form creates a department's first budget, so it must offer departments holding none. A filter
narrows what exists.)

### A filter states what it is hiding

With any filter applied the screen shows the count it is displaying out of the total that exist.
A filter can be left set and forgotten in a way a search box cannot, and the next reader must not
mistake 4 rows for the whole configuration.

## Sequence: what writes `budget_txn`

Nothing. This change adds three optional read parameters and three controls; it writes no row of
any table, touches no ledger, and opens no transaction. There is no locking to specify and no
concurrency surface to test.

## Risks / Trade-offs

- **[Another list read grows optional parameters]** → more shapes the endpoint can be called in.
  Mitigation: each is `$and`ed onto the scoped predicate through the same composition search already
  uses, so no combination can reach a row company scope excluded — which is the only property that
  matters, and it is testable directly.

- **[The active filter narrows nothing today]** → a control that appears to do nothing invites the
  belief that it is broken. Mitigation: it behaves correctly on the data that exists (every row is
  active, so "active" returns all 80 and "inactive" returns none), and the deactivated case is
  covered by a test rather than left to the day it first occurs.

## Migration Plan

No schema change, no data change. Backend and frontend deploy together — the client's new
parameters need the read to accept them, though an older server would ignore them rather than fail.
Rollback is a revert.

## Open Questions

None.
