## Why

The quarterly view opens on twenty departments and 112 budget lines and offers no way to narrow
them. To read one department the user expands it and scrolls past the other nineteen; to find
`1.101` they scroll; to find what has overspent they read every row, because the warning that a
line beneath a department has overspent is a tag, not a filter.

The read already takes the two filters that matter. `BudgetQuarterService.byQuarter(fiscalYearId,
departmentId)` has accepted both since it shipped, `BudgetBalanceQueryDto` validates both, and
`reportsApi.budgetByQuarter` and `loadBudgetByQuarter` both pass them through. Only the screen
never sends anything — it calls `loadBudgetByQuarter()` with no argument and takes whatever the
server's default year returns. The filters are not missing; they are unreachable.

Two facts decide how this is built, and both are already settled elsewhere in the codebase:

- `web-dashboards` requires that applying a filter **re-runs the report**, not that it hides rows
  already on screen. A department filter is therefore a server round-trip.
- `/fiscal-years` is admin-gated, and a `REPORT_VIEW` user cannot call it. The budget-to-ledger
  reconciliation already solved this by returning `fiscalYears` alongside its rows. The same
  problem now applies twice over: once a department filter is applied the response contains that
  one department, so the response can no longer populate its own picker either.

## What Changes

- The quarterly read returns **the fiscal years it can be run for** and **every department it
  could report on**, independent of the filters in force. Without them the pickers empty
  themselves the moment they are used.
- The screen gains a **fiscal-year picker** and a **department picker**, each re-running the read
  on the server, in the `PageHeader` actions slot where the reconciliation report already puts its
  year picker.
- The screen gains two in-page narrowings over what is already loaded, which are NOT server
  round-trips because the answer is already in the response:
  - a **search** over budget code and name, keeping a department whose lines match
  - an **overspent-only** toggle
- An empty result is **stated in words**, distinct from the empty state that means the fiscal year
  holds no budgets at all. "No rows" and "no rows matching `1.101`" send the reader to different
  places.
- The KPI tiles and every figure continue to describe **what the filters selected**, never the
  unfiltered year — a total that disagrees with the table beneath it is worse than no total.

## Capabilities

### New Capabilities

None. This makes an existing read reachable and adds no new behaviour to the budget ledger.

### Modified Capabilities

- `budget-period-reporting`: the read returns the fiscal years and departments it can be run for,
  and the screen requirement gains the filters, the in-page narrowings and the distinction between
  an empty year and an empty match.

`web-dashboards` is NOT modified: its `Report Filters` requirement already states the rule this
change follows, and the point of the change is to comply with it rather than to alter it.

## Impact

- `back/src/modules/reporting/budget-quarter.service.ts` — `BudgetQuarterReport` gains
  `fiscalYears: FiscalYearRef[]` and `departmentOptions: { id, name }[]`, both resolved before the
  filters narrow anything. `departmentOptions` is named apart from the existing `departments`,
  which carries the report rows and shrinks to one when a department is chosen.
- `back/src/modules/reporting/budget-quarter.spec.ts` — the two lists stay complete under a filter,
  and neither leaks another company's rows (invariant 1).
- No change to the controller or its DTO: `BudgetBalanceQueryDto` already validates both ids as
  UUIDs, and the endpoint already forwards them.
- `front-end/src/api/reports.ts`, `front-end/src/views/reports/BudgetQuarterReport.vue` and its
  spec; `front-end/src/i18n/locales/{en,la,zh}/reports.ts` for the new labels in all three.
- No migration, no schema change, no write. The ledger is untouched (invariant 2) and consumption
  is still `Σ RESERVE − Σ RELEASE` (invariant 3).
- Company scope is unchanged: both new lists are resolved through the active company, the same way
  the report's rows already are (invariant 1), and the read stays behind `REPORT_VIEW`
  (invariant 6).
- The read must still make ONE pass over the ledger, and it does. The two lists CANNOT be drawn
  from the budgets already loaded — that query is itself narrowed by `departmentId`, so under a
  filter it knows about one department. Each list is a small query of its own, against
  `fiscal_year` and against the year's `budget` rows: the read goes from three queries to five,
  and the ledger scan stays exactly one. The existing test that pins the query count changes from
  3 to 5 and keeps its purpose — no query per quarter, per month, or per filter.
