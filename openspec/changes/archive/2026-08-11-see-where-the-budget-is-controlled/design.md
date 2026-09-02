## Context

After `choose-where-budget-is-controlled`, the control point is the thing that decides whether a
document can be submitted, and the budget row is the thing money posts to. The screens still only
know about the second one.

What exists to build on:

```
  GET /budgets                          flat, company-scoped, per-row derived `available`
  GET /budgets/:id/control-points       one budget's governing points, each with `available`   ← built last change
  GET /budgets/control-points           all points for the company — config fields ONLY, no amounts
  GET /budgets/control-points/:id/balance   full breakdown + governedBudgetCount
```

`BudgetCoverageService` already answers both directions (`resolveControlPoints` for many budgets at
once, `budgetsGovernedBy` for the inverse), and `BudgetBalanceService.breakdownAt` already produces
the component split. So the domain work is done; what is missing is a read shaped for a list, and
two screens.

NAV is data, not markup: entries live in `front-end/src/layouts/store/layout.store.ts` as
`{ key, to, permission }` and are filtered by permission there, with labels in
`i18n/locales/{la,en,zh}/nav.ts`.

## Goals / Non-Goals

**Goals:**

- A user can open the category that governs their spending directly, without first opening one of
  its children.
- The budget list shows the pooling: the ceiling for a group, and which lines are over their own
  amount while the group still holds.
- A budget governed by several control points appears exactly once in the list.
- A budget governed by none is visible and flagged, not silently dropped.
- Every amount on screen is a server-derived string formatted to the base currency's
  `decimal_places` — no subtotal is summed in the browser.

**Non-Goals:**

- Creating, editing, deactivating or moving control points from the UI, and the tolerance-ladder
  editor. Changing where money is governed is a different act from seeing it.
- `cap_amount`. Still rejected server-side; the screens render it read-only when it is null, which
  is always.
- Any change to how budgets are checked, reserved, or posted.

## Decisions

### D1 — Extend the control-point list read instead of fanning out per row

**This corrects the proposal**, which said no server read would change shape. Building the screens
against the reads as they are produces an N+1 in two places at once: the control-points list would
need one `/balance` call per point to show any amount, and the budget tree would need one
`/budgets/:id/control-points` call per budget to know its group.

`GET /budgets/control-points` therefore gains, per row, the derived `ceiling`, `used`, `available`,
and `governedBudgetIds`. Two calls then build everything: the budget list (already loaded) plus the
control-point list, joined client-side by id.

The alternative — a dedicated "budget tree" endpoint returning the assembled hierarchy — was
rejected because it puts a presentation decision (how budgets group) behind an API, and the grouping
rule in D2 is exactly the kind of thing that gets revised once people use it. Returning the raw
coverage keeps that revisable without a server change.

`governedBudgetIds` is a list of ids, not embedded budget objects: the budget rows are already on
the client from `GET /budgets`, and embedding them would let the two reads disagree about the same
budget's available.

### D2 — A budget groups under its BINDING control point

A budget may be governed by several points. It appears once, under the one with the least
`available` — the ceiling that will refuse it first, which is the only one whose number changes what
the user can do next.

*Alternatives considered:* group under the *nearest* point (fewest tree levels away) — predictable
but can show a ceiling with plenty of room while a wider one is nearly exhausted, which is the exact
confusion this change exists to remove. Or list the budget once per governing point — honest about
the many-to-many, but the same amount appears several times in one list and the totals stop meaning
anything.

The budget detail already lists *all* governing points with the tightest tagged, so nothing is
hidden by choosing one for the list.

### D3 — The category row is not a budget and must not look like one

The group header shows the control point's ceiling and available, and is visually distinct from the
budget rows beneath it. It does not link to a budget detail, is not selectable in any budget picker,
and shows no `status` chip — a control point has `is_active`, not a budget lifecycle.

This matters more than it sounds. The whole reason `1.100` has no `budget` row is that a parent is a
rollup, not an envelope; a UI that renders it as just another budget line re-creates in people's
heads the parent/child divergence the data model was shaped to prevent.

### D4 — Ungoverned budgets get their own group, flagged

The coverage invariant makes an ungoverned ACTIVE budget unreachable through supported paths, and
the migration refuses to finish if one exists. A row landing in this group therefore means something
is wrong — a direct DB write, or a bug — and the screen says so rather than rendering it as an
ordinary budget with no ceiling. Rendering it quietly would be the same failure mode as the invariant
itself guards against: spending that nothing checks, and nothing says so.

### D5 — Grouping and its subtotals are assembled client-side; the numbers are not

The tree is built in the store from two loaded lists. Every amount shown — group ceiling, group
available, per-budget available — comes from a server-derived field and is passed to `formatAmount`
as the original string. No group total is computed by adding numbers in the browser: the control
point's `available` already accounts for its whole governed set, including budgets outside the
current page of the budget list, so a browser-side sum would be wrong as well as forbidden.

## Sequence and locking

This change writes nothing. No `budget_txn` or `quota_usage` row is created, updated or read for
mutation, so no unit of work, no transaction boundary and no lock is introduced. The reads it uses
(`GET /budgets`, `GET /budgets/control-points`, `GET /budgets/control-points/:id/balance`) run
outside any transaction on a forked EntityManager, as the existing budget reads do, and are scoped
to the active company through `fiscal_year.company` / `budget_control_point.company_id`
(invariant 1).

The one server-side addition, the derived fields on the control-point list, reuses
`BudgetCoverageService.budgetsGovernedBy` and `BudgetBalanceService.balanceAt` unchanged — the same
functions the reservation path calls under lock. They are pure reads; calling them without a lock
here is correct because nothing is decided on the result. A number shown on a list is advisory by
the time it reaches the browser regardless, and the authoritative check still happens under the
control-point lock at submit.

## Risks / Trade-offs

- **The list read gets heavier: one `balanceAt` per control point per request.** → At the current
  scale (5 points, 10 budgets) this is trivial. It grows with the number of control points, not
  transactions, and control points are configuration. If it ever shows up, this is precisely the
  read the `budget_balance` projection recorded in the previous change's design would serve.
- **The binding-point rule reorders the list as spending happens.** A budget can move between groups
  when a different ceiling becomes the tightest. → Accepted and worth surfacing: the group a budget
  sits in *is* the thing that will refuse it, so a move is information, not noise. The detail panel
  continues to list every governing point.
- **A tree makes the budget list harder to scan for someone who just wants a flat list.** → The
  grouping is a view of the same rows, not a filter; sorting and the existing columns stay. If this
  proves annoying, a flat/grouped toggle is a small follow-up — deliberately not built now on a
  guess.
- **Two screens showing the same numbers can drift.** → Both read the same server-derived fields and
  neither recomputes; the control-point detail's breakdown comes from `breakdownAt`, which already
  reuses `balanceAt` for `available` so the two cannot disagree.

## Resolved before implementation

- **The control-points list defaults to the current fiscal year.** A control point's ceiling is a
  per-year figure, so showing several years side by side would put two unrelated numbers for the
  same category in one list and invite reading them as one. The API's optional `fiscalYearId` is
  filled in from the fiscal year covering today; if none covers today the list falls back to the
  most recent open year rather than showing everything.
- **The group header states that its figures cover the whole group, not the current page.** The
  budget list pages server-side, so a group's children can be split across pages while the header's
  ceiling and available always describe the entire governed set — they come from the control point,
  which knows nothing about paging. Rather than paging by group or loading every budget at once,
  the header carries a label saying so. It is the cheapest option and the only one that stays true
  as the list grows; the alternative of silently showing a group total next to a partial set of
  children is exactly the parent/child mismatch this whole line of work exists to remove.

## Open Questions

None outstanding. Two remain worth revisiting after people use the screens: whether the budget list
needs a flat/grouped toggle (deliberately not built on a guess), and whether a budget moving between
groups as spending shifts the binding ceiling reads as information or as noise.
