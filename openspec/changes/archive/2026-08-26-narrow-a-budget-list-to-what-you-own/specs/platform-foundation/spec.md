## MODIFIED Requirements

### Requirement: Paginated list endpoints

Every list endpoint (a `GET` that returns a collection) SHALL be server-paginated. It SHALL
accept `page` (1-based) and `limit` query parameters (validated; a sensible default when
omitted and a hard maximum `limit` to bound the page size) and SHALL return a paged envelope
`{ items, total, page, limit }`, where `total` is the count of all rows matching the query
(not just the returned page). Company scope (invariant 1) and any existing filters SHALL be
applied to the query **before** the page window, so `total` reflects the scoped/filtered set
and rows never leak across companies. The page window SHALL be produced by a single
count+slice over the database (e.g. MikroORM `findAndCount` with `offset`/`limit`), not by
slicing an already-materialized full result in memory.

A paginated endpoint SHALL impose a TOTAL order on its query — an ordering that no two rows tie
on — so that paging it end to end returns every matching row exactly once.

Without one, the database is free to return each `LIMIT`/`OFFSET` query in a different order, and
the pages then overlap and leave gaps: some rows appear on two pages and others on none. The budget
list shipped this way, and paging the customer's 496 rows returned 7 of them twice while others
could not be reached at all. It is invisible on a dataset that fits one page, invisible to a type
check, and invisible to any test that reads only the first page — a reader simply never finds a row
they know exists. Ordering by a meaningful column is not sufficient on its own where that column can
tie; a unique tiebreaker SHALL follow it.

A list endpoint MAY accept a free-text `search` term. Where it does, the term SHALL be applied to
the query **before** the page window, like every other filter, so `total` counts the matches and a
match on any page is reachable from the first. The term SHALL narrow the already-scoped set and
SHALL NOT widen it: it cannot reach a row that company scope, permission scope or an existing
filter excluded.

An endpoint SHALL NOT accept a `search` term it does not apply. Declaring the parameter on the
shared pagination DTO would make every list endpoint accept one and silently drop it, which is the
same falsehood as a search box wired to nothing — the caller is told the request was understood.
The parameter therefore belongs to a searchable variant of that DTO, used only by endpoints that
implement it.

#### Scenario: List returns a bounded page with a total

- **WHEN** a client requests a list with `page=1&limit=20`
- **THEN** at most 20 items are returned along with the full `total` of matching rows and the
  echoed `page` and `limit`

#### Scenario: Paging is applied after company scope and filters

- **GIVEN** rows exist in more than one company
- **WHEN** a paginated list is requested in the active company
- **THEN** only the active company's rows are counted and returned, and the page window is
  taken from that scoped/filtered set

#### Scenario: Limit is bounded

- **WHEN** a client requests a `limit` above the allowed maximum (or omits it)
- **THEN** the effective limit is clamped to the maximum (or the default) rather than
  returning an unbounded result

#### Scenario: Paging end to end reaches every row exactly once

- **GIVEN** a list holding more rows than one page
- **WHEN** a client requests every page in turn
- **THEN** each matching row is returned exactly once, and none is missed

#### Scenario: The same page twice returns the same rows

- **GIVEN** a list whose underlying data has not changed
- **WHEN** the same page is requested twice
- **THEN** the same rows are returned in the same order

#### Scenario: A search term is applied before the page window

- **GIVEN** a list whose matching rows would fall on a later page unfiltered
- **WHEN** it is requested with a search term and `page=1`
- **THEN** the matches are returned on the first page and `total` is the count of matches

#### Scenario: A search term cannot reach another company's rows

- **GIVEN** a row in another company whose text matches the term
- **WHEN** a list is searched from the active company
- **THEN** that row is neither returned nor counted
