## ADDED Requirements

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
