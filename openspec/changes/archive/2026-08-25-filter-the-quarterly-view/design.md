## Context

`BudgetQuarterService.byQuarter(fiscalYearId?, departmentId?)` resolves a fiscal year, loads that
year's budgets — narrowed by `departmentId` when one is given — makes ONE pass over every
`budget_txn` of those budgets, and rolls the rows up into departments. Three queries: the fiscal
year, the budgets, the ledger.

The controller and DTO already accept and validate both ids, and both the API client and the Pinia
action already forward them. The screen is the only layer that never sends anything.

Two constraints are not negotiable here, and both are already answered elsewhere in this codebase:

- `web-dashboards` → `Report Filters`: applying a filter SHALL re-run the report. Hiding rows that
  are already on screen is not a filter under that requirement.
- `/fiscal-years` is admin-gated. `BudgetLedgerReconciliationView` already handles this by taking
  its year list from the report response rather than from the admin endpoint, and its picker is a
  `<Select>` in `PageHeader`'s `#actions` slot.

This is a read. No `budget_txn`, no `quota_usage`, no transaction boundary and no lock.

## Goals / Non-Goals

**Goals:**

- A fiscal-year picker and a department picker that re-run the read on the server.
- Pickers that stay populated once used — the year list and department list describe what the read
  COULD be run for, never what the current filters left behind.
- Search and overspent-only, answered from the response already in the browser.
- Every figure on screen — tiles included — describing the filtered selection.
- An empty match distinguishable from an empty year.
- One pass over the ledger, still.

**Non-Goals:**

- A date-range filter. The report's unit is a fiscal quarter; a range that cuts one in half has no
  meaning here, and the quarterly figures would stop summing to the year.
- Server-side search or an overspent filter. Both answers are already in the response, and a
  round-trip to re-derive them would be slower and could disagree with the totals beside them.
- CSV export. `Report Filters` requires filters to reach the export "sending the same filters to
  the CSV export" — this report has no export to send them to. Adding one is its own change.
- Persisting a filter selection across visits.
- Any change to reserving, releasing or governing budget.

## Decisions

**The two lists are separate queries, not a by-product of the budgets already loaded.**
The obvious implementation reuses `budgets` for the department list, and it is wrong: that query
carries `where.department = departmentId` under a filter, so the picker would collapse to the one
department already chosen and strand the user there — the exact failure this change exists to
prevent. Each list is its own small query: the company's `fiscal_year` rows, and the distinct
departments of the target year's `budget` rows.

_Cost, stated plainly:_ three queries become five. The ledger scan — the one that runs over every
document the company will ever raise — stays exactly one, which is the property worth defending.
The existing `reads === 3` assertion becomes `reads === 5` and keeps its purpose: no query per
quarter, per month, or per filter.

**`departmentOptions`, not `departments`.** The response already has a `departments` field holding
the report ROWS, and under a department filter it legitimately holds one. Overloading it would make
"which departments exist" and "which departments are in this result" the same field with two
meanings, which is how a picker ends up filtering itself. The new field is named apart.

**Search and overspent are client-side, and that is not a violation of `Report Filters`.**
That requirement governs filters whose answer the server holds — a different fiscal year is data
the browser does not have. Search over code and name, and "did this row overspend", are decided
entirely by fields already in the response. Re-running the read to compute them would be slower,
and would open a window where the tiles and the table disagree.

**Search keeps a department when any line beneath it matches.** The tree's parents are departments
and its children are budget lines; a search for `1.101` that dropped the department would drop the
row it was meant to find. A department whose OWN name matches keeps all its lines.

**Filtered figures are recomputed for the tiles, not read off the response.** The tiles today sum
`yearConsumed` across every department in the response. Once search or the overspent toggle
narrows the tree, a tile that still totalled everything would contradict the table directly
beneath it. They sum the rows actually shown.

**An empty match says which emptiness it is.** `EmptyState` today means "this fiscal year holds no
budgets". A search matching nothing is a different fact with a different next action — clear the
search. Two messages, chosen by whether anything was loaded before narrowing.

## Risks / Trade-offs

- **Five queries where there were three** → Both additions are indexed lookups on `fiscal_year` and
  `budget` scoped to one company and one year, not scans of `budget_txn`. Pinned by the query-count
  test so a sixth cannot appear unnoticed.
- **A department filter plus a search can produce nothing, twice over** → The empty message names
  the narrowing in force, so the reader knows which control to undo.
- **The year picker changes the department list under the user** → It should: departments are
  per-fiscal-year budgets, and offering last year's departments for this year would let the user
  select one with no rows. Changing the year clears the department selection rather than carrying a
  choice that may not exist in the new year.
- **Three languages drift** → Every label lands in `en`, `la` and `zh` in the same task, as the
  quarterly screen's existing keys did, and `i18n.parity.spec.ts` fails the build if one is missed.
  That guard has already caught a key inserted into the wrong block on this very screen.

## Migration Plan

No migration, no schema change, no backfill. The read is additive — every field today's clients
consume keeps its name and meaning — so the backend can ship before the frontend. Rollback is
reverting the code.

## Open Questions

None. Both server-side filters already exist end to end and are validated; the two new response
fields follow a shape (`FiscalYearRef[]`) the reconciliation report already returns for the same
reason.
