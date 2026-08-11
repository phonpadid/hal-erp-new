## 1. Widen the control-point list read

- [x] 1.1 Extend `ControlPointView` in `budget-control-point.service.ts` with `ceiling`, `used`, `available` and `governedBudgetIds`
- [x] 1.2 Populate them in `list()` by reusing `BudgetCoverageService.budgetsGovernedBy` and `BudgetBalanceService.balanceAt` — no new query shape, no stored figure on the control point
- [x] 1.3 Resolve coverage for the listed points in one pass rather than per row, so the list read does not become the N+1 it exists to remove
- [x] 1.4 Leave `GET /budgets/control-points/:id/balance` and `GET /budgets/:id/control-points` untouched
- [x] 1.5 Test: the list's `available` for a point equals that point's own balance endpoint, across a set with reserves, releases and an adjustment
- [x] 1.6 Test: a point governing six budgets returns all six ids; a point governing none returns a ceiling of 0, available of 0 and no ids
- [x] 1.7 Test: the list stays company-scoped and `BUDGET_VIEW`-gated

## 2. API client and store

- [x] 2.1 Add `ControlPointSummary` to `front-end/src/api/budgets.ts` (config fields + `ceiling`, `used`, `available`, `governedBudgetIds`) and a `controlPointList()` read
- [x] 2.2 Add `controlPointBalance(id)` for the detail screen, typed on the existing breakdown shape plus `governedBudgetCount`
- [x] 2.3 Add control-point state to the budgets store: the list, the current point's breakdown, loading and error, mirroring how budgets are held today
- [x] 2.4 Add a `groupedBudgets` getter that joins the loaded budget list to the loaded control-point list — see 3.1 for the rule
- [x] 2.5 Test the store: grouping, the binding-point choice, and the ungoverned bucket

## 3. Budget list as a tree

- [x] 3.1 Implement the binding-point rule: a budget groups under the governing point with the least `available`; ties resolve deterministically (lowest control point id) so the list does not reorder between loads
- [x] 3.2 Render group headers with account node, department node, ceiling and available, visually distinct from budget rows
- [x] 3.3 Ensure the header carries no status chip, does not link to a budget detail, and is not selectable — a control point cannot be charged
- [x] 3.4 Take every group figure from the control point's server-derived values; sum nothing in the browser
- [x] 3.5 Put budgets with no governing point in a group flagged as a configuration fault, with its own label rather than an empty header
- [x] 3.6 Keep the existing columns, sorting and paging working; label the group header so it is clear its figures cover the whole group, not just the rows on this page (settled: header carries the label, no paging-by-group and no load-everything)
- [x] 3.7 Test: six budgets under one point group together; a budget under two points appears once under the tighter one; an ungoverned budget is flagged

## 4. Control points list screen

- [x] 4.1 Create `ControlPointListView.vue` — account node, department node, ladder, ceiling, used, available, governed count; each row links to the detail
- [x] 4.1b Default the list to the fiscal year covering today, falling back to the most recent open year when none does — a ceiling is a per-year figure and mixing years puts two unrelated numbers for one category in one list
- [x] 4.2 Format every amount with `formatAmount` and the base currency's `decimal_places`, never a JS number
- [x] 4.3 Register the route with `meta.permission = 'BUDGET_VIEW'` in `router/routes.ts`
- [x] 4.4 Add the NAV entry in `layouts/store/layout.store.ts` (`key`, `to`, `permission: 'BUDGET_VIEW'`)
- [x] 4.5 Add nav + screen i18n keys to `locales/{la,en,zh}`
- [x] 4.6 Test: rows render with their figures, the screen is permission-gated, and amounts honor the currency decimals

## 5. Control point detail screen

- [x] 5.1 Create `ControlPointDetailView.vue` — breakdown components reconciling to available, the tolerance ladder, and the governed budgets each with its own available
- [x] 5.2 Show a governed budget whose own available is negative distinctly, since that is the case the screen exists to explain
- [x] 5.3 Link each governed budget to its budget detail
- [x] 5.4 Register the route (`BUDGET_VIEW`) with a breadcrumb back to the control points list
- [x] 5.5 Test: breakdown reconciles, the ladder renders both rungs, a negative child is shown, amounts honor the currency decimals

## 6. Styling and verification

- [x] 6.1 Use PrimeUI theme tokens only, so light and dark both work; icons are PrimeIcons
- [x] 6.2 Run the front-end suite and typecheck; run the backend budget suite for the widened list read
- [x] 6.3 Drive the running app: open the control points list, open the category detail, and confirm the budget list groups — against the ພະແນກ ບໍລິຫານ data already seeded locally
- [x] 6.4 Record in design.md whichever answers review settles for the two open questions (fiscal-year default, group-versus-page)

## 7. Reading polish (found by looking at the screen, not the tests)

- [x] 7.1 Right-align money in tabular figures on the budget list — the house pattern from ReadyToPayView/SettlementsView, which the first cut did not follow, so digits did not line up down the column
- [x] 7.2 Colour an overdrawn budget in the LIST, not only on the detail — the most important number on the screen was rendering exactly like a healthy one
- [x] 7.3 Tint the group header row and indent its children so the hierarchy reads without relying on colour
- [x] 7.4 Lead the group header with a utilisation bar and percentage, reusing the utilization report idiom — the ceiling governs every row beneath it and was reading as trailing small print
- [x] 7.5 Pin all four in a spec, since none of them is visible to a type check or a behavioural test
- [x] 7.6 Let the utilisation bar take the slack in the group header instead of a fixed w-24 — at ~84px a 91.2% fill was indistinguishable from 100%, so the bar showed the colour but not the margin
- [x] 7.7 Give every group bar the same fixed width in a right-aligned column — flex-1 (7.6) scaled each bar to its row, so lengths were only comparable within a row, which is the one thing a column of bars is for
- [x] 7.8 Span the group header cell across every column — PrimeVue sets it to columnsLength - 1, leaving the last column with no cell, and a browser paints no row background where no cell exists, so the tint stopped short of the table edge
- [x] 7.9 Move status in front of the money columns so the table ends in one unbroken money block — and because the group header spans the whole row, its figures then land on the same right edge as the children they summarise
- [x] 7.10 Draw the fill behind the figures as a data bar instead of a separate ProgressBar — one block to read rather than four, and unlike PrimeVue ProgressBar slot it survives value === 0, where that slot is not rendered at all
- [x] 7.11 Put the figures inside PrimeVue ProgressBar via its default slot, with pass-throughs that make the label span the whole track and survive value === 0
