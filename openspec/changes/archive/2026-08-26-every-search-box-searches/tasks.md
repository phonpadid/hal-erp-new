## 1. One way to search

- [x] 1.1 `back/src/common/pagination/pagination.ts` — `withSearch(where, term, fields)`: returns
      `where` untouched for a blank term, otherwise `$and`s an `$or` of `$ilike` over `fields`. It
      narrows the caller's already-scoped `where` and can never replace it.
- [x] 1.2 Same file — `SearchablePaginationQueryDto extends PaginationQueryDto` with a validated,
      length-capped optional `search`. Deliberately NOT on `PaginationQueryDto`.
- [x] 1.3 Unit spec: a blank/absent/whitespace term returns the input `where` by value; a term
      produces a predicate that still contains the caller's original clauses.
- [x] 1.4 Unit spec: a row in another company matching the term is neither returned nor counted.

## 2. The two screens whose data does not fit a page

- [x] 2.1 `AccountService.list` + its controller/DTO — search `code`, `name`. 4,067 rows.
- [x] 2.2 `BudgetService.list` + its controller/DTO — search the node's `code` and `budget_name`.
- [x] 2.3 Front: `api/accounts.ts`, `api/budgets.ts`, their stores and views send the term and reset
      to page 1.
- [x] 2.4 Spec: on the chart of accounts, a code that would fall on a later page is found from
      page 1, and `total` is the count of matches.

## 3. The nine remaining server-paged screens

- [x] 3.1 Quota, master data (vendors and items), warehouses, tax codes, dept mappings, currencies,
      job levels, approval delegations, stock balances — each service gains one `withSearch(...)`
      call naming its identifying columns, each controller the searchable DTO.
- [x] 3.2 Their stores and views send the term and reset to page 1.
- [x] 3.3 Spec per endpoint: a term narrows, a non-matching term empties, and neither reaches
      another company. Delivered as one DB-backed spec (`common/pagination/list-search.spec.ts`)
      covering both scoping styles — an explicit `where` clause and MikroORM's `company` filter
      with no clause of its own — since every endpoint reaches the database through the same
      helper. It caught a real defect: a dotted path (`node.code`) emitted an alias that was
      never joined, so the four relation-searching endpoints would have failed outright.

## 4. The three screens that already hold every row

- [x] 4.1 `AppDataTable` — a `clientPaged` prop that turns `lazy` off, so PrimeVue applies the
      filter bindings it is given.
- [x] 4.2 `ControlPointListView`, `RbacAdminView`, `ReadyToPayView` set it and keep their existing
      `filters` / `globalFilterFields`.
- [x] 4.3 Component spec: with `clientPaged`, a term filters across every loaded row, and the
      development guard does not fire.

## 5. Close the loop

- [x] 5.1 No screen passes `filters` to a lazy table: grep, and the guard is silent when the app is
      exercised.
- [x] 5.2 `pnpm --filter back test` (2006 passed), `pnpm --filter front-end run ci` (1014
      passed), and `back/e2e` (83 passed). The e2e suite would not start at all: its support
      module defaulted to port 5000 while `playwright.config.ts` defaults to `PORT ?? 3000`,
      so the config waited on one port and every flow signed in against another. One default
      now, derived the same way.
- [x] 5.3 Walk each of the fourteen screens in the browser: type a term, get a narrowed list; type
      nonsense, get an empty one. Done against `demo_erp`; the development guard stayed silent on
      every one. Six screens hold no rows in this database, so their narrowing is shown by the
      backend spec rather than the browser. The walk found one more dead box: the budget screen's
      tree mode is a TreeTable fed by its own full load, which the term does not narrow — the field
      is no longer offered there.
- [x] 5.4 Fold the deltas into `openspec/specs/web-ui-quality/spec.md` and
      `openspec/specs/platform-foundation/spec.md`.
