## Why

`choose-where-budget-is-controlled` moved the availability check to a `budget_control_point` and
gave it everything it needs to govern spending — coverage, locking, a tolerance ladder, a derived
balance, and a full API. What it did not give it is a screen.

The consequence shows up immediately on real data. Loading the customer's 2026 sheet produces a
category `1.100 ຄ່າບໍລິຫານ ທົວໄປ` with a ceiling of 534,000,000 governing six lines. That category
is the number the budget owner reads every day. In the system it is an `account` node and a control
point — deliberately **not** a `budget` row, because a parent is a rollup and not an envelope — so
`GET /budgets` correctly omits it, and the only place it appears on screen is inside a *child*
budget's detail panel. To learn what the category has left, a user must first open a line that
belongs to it and read the panel.

The gap is sharpest exactly where the previous change is most valuable. Budget `1.104` shows
`-138,208,500` available on its own while the category that actually governs it still has
46,791,500. Both numbers are correct and the spend is legitimately allowed, but a user who can only
reach the negative one has no way to see why. The previous change solved "where is budget
controlled"; this one solves "where can a person see it".

This is scoped read-only on purpose. Seeing a ceiling and editing one are different acts with
different consequences: moving a control point changes how money is governed for everyone under it,
and that deserves its own change with its own scenarios rather than riding along with a viewer.

## What Changes

- **New control-points screen (list).** A company-scoped list of `budget_control_point` rows for a
  fiscal year, each showing its account node, department node, tolerance ladder, ceiling, used, and
  derived available, with the budgets it governs counted. Gated by `BUDGET_VIEW`.
- **New control-point detail.** One control point's derived balance broken into the same components
  a budget breakdown uses, plus the list of budgets it governs with each one's own available — so
  the pooling is visible: which lines are over their own amount and which are carrying the category.
- **Budget list becomes a tree.** Budgets group under the control point that governs them, with the
  category row showing the ceiling and available for the group and its children indented beneath.
  The category row SHALL be visually distinct from a budget row and SHALL NOT be selectable as a
  budget — it holds no money of its own and charging a document to it is meaningless.
- **A budget governed by several control points appears once.** Grouping uses the *binding* control
  point — the governing one with the least available, the ceiling that refuses first. The other
  governing points remain visible on the budget detail panel, which already lists all of them.
- **Ungoverned budgets are surfaced, not hidden.** A budget with no governing control point cannot
  be grouped; it is shown in its own group flagged as a configuration fault. The coverage invariant
  makes this unreachable through supported paths, so a row appearing there is a signal worth seeing
  rather than a state to render quietly.
- **Navigation entry.** The control-points screen is registered in NAV with la/en/zh labels,
  permission-gated like the other budget entries.

- **`GET /budgets/control-points` gains derived fields.** Each row adds `ceiling`, `used`,
  `available` and `governedBudgetIds`. Without them both new screens are an N+1 — one `/balance`
  call per control point to show any amount, and one `/budgets/:id/control-points` call per budget
  to know its group. With them, two reads build everything.

Deliberately **not** in this change: creating, editing, deactivating or moving control points from
the UI; the tolerance ladder editor; and any change to what `GET /budgets` returns. The budget list
stays a flat company-scoped read — the tree is assembled client-side by joining it to the
control-point list, so grouping stays a presentation decision rather than something frozen behind an
API.

## Capabilities

### New Capabilities

None. These are budget screens; they extend `web-budgets`.

### Modified Capabilities

- `web-budgets`: adds a control-points list and detail, and changes the budget list from a flat
  table to a tree grouped by governing control point, with the category row non-selectable and
  ungoverned budgets flagged.
- `budget-control`: the control-point list read gains the derived `ceiling`, `used`, `available` and
  the ids of the budgets each point governs, so a list of control points can be shown without a
  balance call per row.

## Impact

**Frontend** — new `ControlPointListView` and `ControlPointDetailView` under `views/budgets/`; the
budget list view gains grouping; `api/budgets.ts` gains reads for the control-point list and its
balance (`GET /budgets/control-points`, `GET /budgets/control-points/:id/balance`); the budgets
Pinia store gains control-point state; router and NAV registration; i18n keys in la/en/zh.

**Backend** — one read widens. `BudgetControlPointService.list` adds the derived `ceiling`, `used`,
`available` and `governedBudgetIds` per row, reusing `BudgetCoverageService.budgetsGovernedBy` and
`BudgetBalanceService.balanceAt` unchanged. `GET /budgets/control-points/:id/balance` and
`GET /budgets/:id/control-points` are untouched, as is every write path.

**Permissions** — reuses `BUDGET_VIEW`. No new permission code.

**Invariants** — read-only screens; no ledger is written, so invariants 2, 3 and 4 are untouched.
Invariant 1 holds through the existing company-scoped reads. The money rule applies throughout:
every amount stays a string formatted to the base currency's `decimal_places`, including the
grouped subtotals, which are taken from the server's derived balance rather than summed in the
browser.
