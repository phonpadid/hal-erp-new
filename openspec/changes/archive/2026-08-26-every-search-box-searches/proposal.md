## Why

Fixing the approval inbox's dead search box added a guard to `AppDataTable`: passing PrimeVue's
client-side `filters` to a table running in `lazy` mode is silent decoration, because PrimeVue
delegates filtering to the server in that mode and ignores the binding. The guard fired immediately,
on a screen nobody had reported — and a sweep found **fourteen** screens with the same dead control:

```
BudgetListView      QuotaListView        MasterDataView       ControlPointListView
WarehousesAdminView TaxCodesAdminView    RbacAdminView        DeptMappingsView
CurrencyAdminView   JobLevelsAdminView   AccountsAdminView    ApprovalConfigView
ReadyToPayView      StockOnHandView
```

Every one offers a search box that does nothing at all. On the chart of accounts that is 4,067 rows
behind a control that looks like the way through them.

`web-approvals` already states the rule, written when the inbox was fixed: *a search control SHALL
NOT be offered unless it is wired to something that filters.* It was scoped to the inbox because
that is where it was found. It belongs to every list.

## What Changes

**Two screens get server-side search, because their data does not fit a page.**
- `AccountsAdminView` (4,067 rows) and `BudgetListView` (366) page on the server, so the term must
  go with the query. Filtering the loaded page would search 20 of 4,067 and look like it had
  searched all of them.

**Nine more server-paged screens get the same treatment, uniformly.**
- Quota, master data (vendors, items), warehouses, tax codes, department mappings, currencies, job
  levels, approval config and stock all page on the server. Most hold few rows *today* — several
  hold none — but "it fits on one page for now" is not a property the code states or preserves, and
  the first busy company breaks it silently.
- A shared `withSearch()` helper turns a term into a case-insensitive match over the fields each
  service names, so each endpoint changes by about three lines rather than by a hand-rolled query.

**Three screens load every row already, and simply need their filter to run.**
- `ControlPointListView`, `RbacAdminView` and `ReadyToPayView` bind `:total` to an array length —
  the whole dataset is on the client. For those, client-side filtering is the *correct* answer and
  the only reason it does nothing is `lazy`. `AppDataTable` gains a way to page on the client, and
  those three use it.

**A search parameter is never accepted and ignored.**
- `search` goes on a `SearchablePaginationQueryDto`, used only by endpoints that implement it —
  not on the shared `PaginationQueryDto`, which would make every list endpoint accept a term it
  silently drops. That is the same lie as the dead control, one layer down.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-ui-quality`: gains the rule that a list control which appears to filter must filter the whole
  set the list is drawn from — generalising, from the inbox to every list, what `web-approvals`
  already requires.
- `platform-foundation`: *Paginated list endpoints* gains that a list endpoint accepting a search
  term SHALL apply it server-side across the filtered set, and SHALL NOT accept one it ignores.

## Impact

**Build-order capabilities touched:** none changes behaviour. This adds an optional filter to
existing reads across `chart-of-accounts`, `budget-control`, `quota-management`, `master-data`,
`inventory`, `multi-currency`, `job-level`, `document-engine` (mappings) and `approval-workflow`
(delegations). Every one stays company-scoped through the same `CompanyScopeService` it already
uses; a search term narrows a scoped set and can never widen it.

**Invariants:** invariant 1 is the one at risk and is preserved by construction — `withSearch()`
narrows an existing `where` that the caller has already scoped, and cannot replace it. No ledger,
money or approval path is touched; no amount is formatted or compared.

**Code**
- `back/src/common/pagination/pagination.ts` — `withSearch()` and `SearchablePaginationQueryDto`.
- Eleven list services gain a `withSearch(...)` call and their controllers the searchable DTO.
- `front-end/src/components/AppDataTable.vue` — a client-paged mode for tables that hold every row.
- Eleven stores and views pass the term to the server; three switch to client paging.

**Data:** none. No migration, no column, no backfill.

**Not in scope:** what each screen searches *by* beyond the obvious identifying columns (a code and
a name); adding filters those screens do not already offer; and the `RbacAdminView` tables' own
sub-structure, which is three tables in one screen and gets the same treatment without being
redesigned.
