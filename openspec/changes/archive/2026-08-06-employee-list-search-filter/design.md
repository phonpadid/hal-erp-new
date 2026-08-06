## Context

`GET /employees` takes only `PaginationQueryDto` (`page`, `limit`). `EmployeeService.list()`
runs `em.findAndCount(Employee, { company: companyId }, …)` with a fixed `orderBy: empCode ASC`
and no other predicate. On the client, `EmployeeAdminView` declares
`filters = { global: { value, matchMode: CONTAINS } }` and passes it plus `globalFilterFields`
to `AppDataTable`, which forwards them to PrimeVue `DataTable` — but that DataTable is in
`lazy` mode, where PrimeVue delegates all filtering to the server and applies none itself. The
search field is therefore inert, and even if PrimeVue did filter, it would only ever see the
20 rows of the current page.

The document list already solves exactly this problem: `MyDocumentsView` keeps a reactive
filter object, debounces input by 350 ms, and calls `documents.applyFilters()` /
`clearFilters()` on a Pinia store that owns the filter state and reloads from page 1. This
change follows that precedent rather than inventing a second pattern.

The employee endpoint is guarded by `EMPLOYEE_MANAGE`, is company-scoped through
`RequestContext.companyId()`, and masks `salary` unless the caller holds `EMP_SALARY_VIEW`.

## Goals / Non-Goals

**Goals:**
- Make the existing search box actually find employees, across the whole company registry
  rather than the current page.
- Add the filters an HR admin reaches for first: department, status, job level, and whether
  the person has a login account.
- Keep the paginator honest — `total` counts the filtered set.
- Reuse the `MyDocumentsView` + documents-store filter pattern so the two list screens behave
  identically from a user's point of view.

**Non-Goals:**
- No full-text search index, trigram index, or search ranking. `ILIKE '%term%'` over a
  registry of this size is adequate; revisit only if it measurably isn't.
- No user-defined saved filters or per-column filter menus.
- No sorting changes — ordering stays `emp_code ASC`.
- No change to what a caller may see. Filtering only narrows within the active company; the
  salary gate is untouched.
- No change to `AppDataTable`. It stays lazy; the fix is to stop pretending otherwise.
- No URL-query-parameter persistence of filter state (deep links / back-button restore) —
  the documents screen does not do it either, and adding it here alone would be inconsistent.

## Decisions

**Server-side filtering, not client-side.** The alternative — dropping `lazy` and loading
every employee — would make the search box work in three lines. It is rejected: it defeats
pagination, grows unboundedly with the registry, and would ship a different data-loading model
than every other list screen. The server already owns company scope and the salary gate;
filtering belongs on the same side as the authorization it must respect.

**`ListEmployeesQueryDto extends PaginationQueryDto`**, validated by class-validator:
`search` `@IsOptional() @IsString() @MaxLength(100)`; `departmentId` `@IsOptional() @IsUUID()`;
`status` `@IsOptional() @IsIn(EMPLOYEE_STATUSES)`; `jobLevel` `@IsOptional() @IsString()`;
`hasAccount` `@IsOptional() @Transform(…) @IsBoolean()` (query strings arrive as `'true'` /
`'false'`). Rejecting a malformed filter beats silently ignoring it — a 400 tells the caller
their query was not honoured, whereas ignoring it returns a full list that looks like a
legitimate result. `status` reuses the shared `EMPLOYEE_STATUSES` tuple so the DTO, the Zod
schema, and the UI Select cannot drift.

**Predicate composition.** `EmployeeService.list()` builds
`where = { company: companyId }` first, then adds each supplied filter as an AND clause, and
`search` as a single `$or` over `empCode` / `fullName` / `position` using `$ilike`. Company
scope is written first and never conditional, so no reachable code path can drop it — the
same shape `listLinkableAccounts()` already uses for its `$or` search. `hasAccount` maps to
`{ user: { $ne: null } }` / `{ user: null }`. The search term is trimmed; an empty or
whitespace-only term is treated as absent rather than as a match-nothing predicate.

**Search matches `emp_code`, `full_name`, `position` only.** `department_name` is resolved
after the query from a separate `Department` map, so including it would require a join and a
different query shape for one field that already has its own dedicated filter. `salary` is
deliberately excluded: making a permission-gated field searchable would leak its value through
result membership to a caller without `EMP_SALARY_VIEW`.

**Case-insensitivity via `$ilike`, not `lower()`.** Consistent with the existing
`listLinkableAccounts()` search, and it needs no functional index to stay correct.

**Filter state lives in the Pinia store, not the view.** `employeeAdmin` gains a
`filters: EmployeeListFilters` field plus `applyFilters(f)` and `clearFilters()`, both of
which reload from page 1; `load(page, limit)` sends `this.filters` unchanged. This matters
because the store's `run()` helper calls `this.load()` after every mutation — edit, link,
verify, unlink, resign. With filter state in the view, each of those would silently drop the
user's filters and jump back to the unfiltered list. Filters reset to page 1 because the
result set changes size: staying on page 4 of a set that now has one page shows an empty
table.

**Debounce at 350 ms**, matching `MyDocumentsView`, so a typed name fires one request rather
than one per keystroke.

**Filter controls go in `PageToolbar`'s existing `#filters` slot** as PrimeVue `Select`s
styled with theme tokens (no hardcoded colors, so dark mode — the mode in the report — renders
correctly). Department options come from the `/departments` fetch the view already makes; job
level from the `jobLevels` store's `selectable` list already loaded for the edit dialog; status
from `EMPLOYEE_STATUSES`. Every option list is already on the page; none adds a request.

**Delete the `FilterMatchMode` import, the `filters` ref, and `:globalFilterFields`.** Leaving
dead client-side wiring next to working server-side wiring is how someone re-introduces this
bug later.

No budget, quota, document-numbering, or FX path is touched, so there is no `budget_txn` or
`quota_usage` write, no `em.transactional()` boundary, and no pessimistic lock in this change.
`list()` remains a read on a forked EntityManager.

## Risks / Trade-offs

- **`ILIKE '%term%'` cannot use a plain B-tree index → full scan per search.** Mitigation: the
  scan is bounded by one company's employees (hundreds, not millions) and the query is already
  company-filtered, which is itself indexed. If a company's registry grows past the point where
  this is felt, add a `pg_trgm` GIN index on the three searched columns — a pure addition that
  needs no API change.
- **A user-supplied term goes into a `LIKE` pattern.** MikroORM parameterises `$ilike`, so
  there is no injection risk, but `%` and `_` in the term are interpreted as wildcards.
  Mitigation: accepted — a wildcard-y search still only ever returns rows the caller may
  already see, and `@MaxLength(100)` bounds the pattern's cost. Escaping them would surprise
  users who type `_` inside an employee code.
- **Filters could become a scope-widening hole if a future edit reorders the predicate.**
  Mitigation: `{ company: companyId }` is set unconditionally at the top of `list()`, and the
  spec delta carries an explicit scenario asserting a filter never surfaces another company's
  employee — so a regression fails a test, not just review.
- **Frontend and backend filter names could drift.** Mitigation: the `EmployeeListFilters`
  type in `api/employees.ts` mirrors `ListEmployeesQueryDto` field for field, and `status`
  draws from the shared `EMPLOYEE_STATUSES` on both sides.
- **Existing callers of `employeesApi.list(page, limit)`.** Mitigation: the new signature keeps
  `page` and `limit` positional with a third optional filters argument, so no existing call
  site changes; every query parameter is optional server-side, so an old client keeps working.

## Migration Plan

No database migration, no schema change, no data backfill. Deploy is backend-then-frontend in
either order: the new query parameters are optional and additive, so a current frontend against
the new backend is unaffected, and the new frontend degrades to sending parameters an old
backend ignores. Rollback is a plain revert of both — nothing persists any new state.

## Open Questions

- Should the default list hide `RESIGNED` / `TERMINATED` employees (status defaulting to
  `ACTIVE`) rather than showing all? This proposal keeps today's behavior — no filter means
  all statuses — so the change stays purely additive. Worth revisiting once admins use the
  status filter and we can see whether they set it to `ACTIVE` every time.
- Should filter state survive a page reload via URL query parameters? Deferred: the documents
  screen does not do this, and it should be decided for both screens together.
