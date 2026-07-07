## Context

budget-control has `BudgetBalanceService.availableBalance(budgetId)` (one derived number) and
`outstandingReserved(doc, budget)`; balance is always summed from `budget_txn`, never stored
(invariant 3). `GET /budgets`, `/budgets/:id`, `/budgets/:id/balance` exist (`BUDGET_VIEW`).
What's missing for a screen: a component breakdown, a ledger read, and company scoping —
`BudgetService.list()/get()` currently read with `filters: { company: false }` and no company
restriction, so they can leak budgets across companies. The Vue shell + prior web slices give
`can()`, the typed-api/store pattern, `decimal.js`, and currency formatting needs.

## Goals / Non-Goals

**Goals**
- A `BUDGET_VIEW` breakdown read (components that reconcile to available) and an append-only
  ledger read, both company-scoped.
- Scope the UI-facing budget list/get to the active company (fix the isolation leak).
- Vue budget list + detail (breakdown card + ledger), gated by `BUDGET_VIEW`, money formatted
  by the currency's `decimal_places`.
- Tests: breakdown math, ledger read, cross-company exclusion; frontend store + a pure
  derivation/format helper.

**Non-Goals**
- Budget write screens (create/transfer/adjust — `BUDGET_MANAGE`), quota screens, analytics,
  changing the existing `/balance` contract.

## Decisions

### D1 — Breakdown computed from the ledger (one pass)
Add `BudgetBalanceService.breakdown(budgetId, em?)`: load the budget (rejecting if absent),
fold `budget_txn` once into per-type sums with `Money`, and return
`{ amountTotal, adjustIncrease, adjustDecrease, transferIn, transferOut, reserved, actual,
released, available }` (strings). `available` is recomputed by the same formula as
`availableBalance` so the two never diverge. The existing `availableBalance` stays for the
hot reserve/transfer paths; `breakdown` is the read-detail variant. *Alternative:* a GROUP BY
SQL aggregate — rejected for now; the in-memory fold matches `availableBalance`'s exact
Money semantics and avoids decimal/DB-rounding drift.

### D2 — Company scoping (fix invariant 1)
`Budget` has no `company_id` column (it's not `CompanyScopedEntity`), which is why the filter
was disabled. Scope instead through the relation: query
`em.find(Budget, { fiscalYear: { company: companyId } }, { filters: { company: false } })`
using `RequestContext.companyId()`. Apply this to `list`, and have `get`/`breakdown`/`ledger`
resolve the budget and **verify** its `fiscalYear.company === activeCompany` (else
`NotFoundException`, so cross-company ids are indistinguishable from missing). This tightens
existing `list`/`get` — existing budget-control tests run within a single company so they're
unaffected; verified at apply.

### D3 — Ledger read
`BudgetBalanceService` (or a small `BudgetLedgerReadService`) `ledger(budgetId)` → after the
company check, `em.find(BudgetTxn, { budget }, { orderBy: { createdAt: 'DESC' },
populate: ['document'], filters: { company: false } })` mapped to
`{ id, txnType, amount, documentNo, remark, createdAt }`. Read-only; never writes (invariant
2). Place `GET /budgets/:id/breakdown` and `GET /budgets/:id/ledger` on the existing
`BudgetController` (both `BUDGET_VIEW`), after `/:id/balance`.

### D4 — Frontend data layer
`api/budgets.ts`: `list()` (summaries), `get(id)`, `breakdown(id)`, `ledger(id)` — amounts as
strings. `stores/budgets.ts` (Pinia): `list`, `current`, `breakdown`, `ledger`, `loading`,
`error`; actions `loadList`, `loadOne(id)` (fetches get + breakdown + ledger). For the list's
per-row available, `loadList` calls `breakdown` per budget (demo scale; documented) — or shows
the list immediately and lazy-loads available; pick the simple eager path and note it.

### D5 — Formatting + a pure helper
`utils/money.ts`: `formatAmount(value, decimalPlaces)` (decimal.js `toFixed`, no JS-number
math) and `deriveAvailable(breakdown)` returning the recomputed available string — used to
assert the card's components reconcile and unit-tested without a DOM. The detail card lays out
total → +adjust → ±transfer → −reserved − actual + released = available.

### D6 — Views, routing, nav
- `views/budgets/BudgetListView.vue`: DataTable (name, GL, FY, dept, total, available, status),
  row → detail; empty + error states.
- `views/budgets/BudgetDetailView.vue`: breakdown card + ledger DataTable; ledger rows with a
  `documentNo` link to the document detail.
- Route `budgets` (`meta.permission='BUDGET_VIEW'`) + `budgets/:id`; a "Budgets" nav item
  gated by `can('BUDGET_VIEW')`.

## Risks / Trade-offs

- **N+1 on the list** (a breakdown per budget for available) — fine at demo scale; revisit
  with a single aggregate endpoint if budget counts grow. Logged as a known simplification.
- **Tightening `list`/`get` scope** could in theory change behavior for a caller relying on
  the leak — none expected; the demo and tests are single-company. Verified at apply.
- **`fiscalYear.company` vs `department.company`** — both identify the company; scope on
  `fiscalYear.company` (always present on a budget) and trust they agree (a budget's FY and
  dept are same-company by construction).

## Migration Plan

Backend: add `breakdown` + `ledger` reads and company-scope `list`/`get`; `pnpm --filter back
build/test`. Frontend: add `api/budgets.ts`, `stores/budgets.ts`, the two views, `utils/money`,
router/nav, tests; `pnpm --filter front-end build/test`. Validate `openspec validate
web-budgets --type change --strict`. Rollback = revert the budget read additions/scoping and
the `front-end/` additions.

## Open Questions

- Show the available balance as a progress bar (used vs. total) on the list? Default: show the
  number now; add a bar in the detail card only (used = total − available), no extra endpoint.
- Should the ledger paginate? Default: no for this slice (return all, newest first); add
  paging when a budget accrues many transactions.
