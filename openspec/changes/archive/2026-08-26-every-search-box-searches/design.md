## Context

Fixing the approval inbox left a guard on `AppDataTable`: `filters` passed to a `lazy` table is
ignored by PrimeVue, so the binding is decoration. It fired on the first screen visited afterwards,
and a sweep found fourteen.

They are not one problem. Measured against the customer's data:

| shape | screens | why |
|---|---|---|
| server-paged, more than a page of rows | AccountsAdmin (4,067), BudgetList (366) | the term must reach the server |
| server-paged, few rows *today* | Quota, MasterData, Warehouses, TaxCodes, DeptMappings, Currency, JobLevels, ApprovalConfig, StockOnHand | same, because "few today" is not a property the code keeps |
| every row already on the client | ControlPointList (362), RbacAdmin, ReadyToPay (1,207) | `:total` is an array length; client filtering is correct here |

## Goals / Non-Goals

**Goals:**
- Every search box on a list screen filters the whole list, or is not there.
- One way of doing it, so the fifteenth screen inherits it.
- No endpoint accepts a term it drops.

**Non-Goals:**
- Redesigning any of these screens, or adding filters they do not already offer.
- Choosing clever searchable fields. Each service names the columns a person would type — a code
  and a name — and no more.
- Full-text indexing. `ILIKE` over a scoped set of at most a few thousand rows is not the
  bottleneck, and pretending otherwise would add an index nobody measured.

## Decisions

### 1. `withSearch()` in the pagination helper, not eleven hand-rolled queries

Every one of these services already ends in `paginate(em, Entity, where, options, q)`. A shared
helper narrows the `where` they already built:

```ts
export function withSearch<T>(where: FilterQuery<T>, term: string | undefined, fields: string[]): FilterQuery<T>
```

It returns `where` untouched when the term is blank, and otherwise `$and`s an `$or` of `$ilike`
over the named fields. Each call site becomes one line, and the shape cannot drift between screens.

**It narrows, never replaces.** The `where` handed in is the one the caller already scoped by
company and permission; the helper only ever adds to it. That is what keeps invariant 1 true across
eleven endpoints without eleven separate arguments about it — a search term cannot reach a row that
scope excluded, because scope is still in the predicate.

**Alternative considered — a `searchable` option on `paginate()`.** It would hide the fields inside
the pagination call, where a reader looking for "what does this screen search by" would not think to
look. Naming them at the call site keeps the answer next to the query.

### 2. `search` on a searchable DTO, not on `PaginationQueryDto`

Putting it on the shared DTO is one line and covers everything — and makes every list endpoint in
the system accept a term it silently ignores. That is the dead search box again, one layer down:
the caller is told the request was understood.

`SearchablePaginationQueryDto extends PaginationQueryDto` adds `search`, and only the endpoints
that implement it use it. An endpoint that has not been wired keeps rejecting the parameter, which
is the honest answer and which `forbidNonWhitelisted` already gives for free.

### 3. Three screens page on the client, and say so

`ControlPointListView`, `RbacAdminView` and `ReadyToPayView` bind `:total` to `array.length`: every
row is already loaded, and `lazy` is simply wrong for them. `AppDataTable` gains a `clientPaged`
prop that turns `lazy` off and lets PrimeVue do what it is good at.

This is not a lesser fix. Where the client holds the whole set, client-side filtering searches the
whole set — which is the requirement. Sending those three to the server would add three endpoints'
worth of parameters to answer a question the browser already has the data for.

**Note on `ReadyToPay` (1,207 rows).** It loads all of them today. That is its own question — a
payables screen that grows without bound will eventually need paging — but it is the screen's
existing behaviour, not something this change introduces, and conflating the two would hide a
paging decision inside a search fix.

### 4. The guard stays, and gets a way to be satisfied

`AppDataTable` keeps refusing `filters` while `lazy`. With `clientPaged` set, `lazy` is off and the
bindings are honoured, so the three client screens satisfy the guard by being correct rather than by
being exempted.

## Risks / Trade-offs

**Eleven endpoints gain a parameter, and each is a place company scope could be lost.** → The helper
cannot replace the scoped `where`, only narrow it, and a spec asserts a matching row in another
company is neither returned nor counted. That test is written once against the helper and once
end-to-end.

**`ILIKE '%term%'` cannot use a plain index.** → Over a company-scoped set of at most a few thousand
rows this is not worth an index, and adding one now would be a guess. If a screen ever gets slow the
fix is a trigram index on that table, decided with a measurement.

**Turning off `lazy` for three screens changes their paging behaviour subtly** — the paginator now
counts client rows. → That is what their `:total` already said; the change makes the component agree
with the binding rather than the other way round.

## Migration Plan

No migration, no data change. Each endpoint's new parameter is optional and absent means today's
behaviour, so server and client can land independently and in any order.

Verified per shape: a term finds a row that unfiltered would fall on a later page (Accounts, 4,067
rows); a term matching nothing empties the list; a term cannot reach another company's row; and the
three client-paged screens filter every row they hold.

Rollback is reverting the commit.

## Open Questions

- **Should `ReadyToPayView` page on the server?** 1,207 rows load today and it will grow with every
  completed document. Out of scope here; worth its own look.
- **Does any of these screens want to search by something other than code and name?** The obvious
  columns are what this change wires. A screen whose users search by, say, a vendor's tax id can
  say so and gain a field.
