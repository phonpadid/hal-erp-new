## Why

With documents now created, approved, and settled from the browser, users need to *see* the
budget move: the derived available balance (invariant 3), how it breaks down (total, adjusts,
transfers, reserved, actual, released), and the append-only ledger behind it (invariant 2).
The backend exposes only a single available-balance number — no component breakdown and no
ledger read — so a budget screen can't show where the money went. This change adds those two
reads and the Vue budget screens, closing the visual feedback loop for the reserve → actual →
release flow.

A correctness note surfaced while scoping this: `BudgetService.list()/get()` currently read
with the company filter disabled and no company restriction, so they can return budgets across
companies. The UI must honor company isolation (invariant 1), so this change scopes the
UI-facing budget reads to the active company.

## What Changes

- **New capability `web-budgets`** — the budget list + detail screens in the Vue shell.
- **Backend (budget-control delta)**:
  - `BudgetBalanceService.breakdown(budgetId)` + `GET /budgets/:id/breakdown` (`BUDGET_VIEW`)
    → the derived components summed from `budget_txn`: `amountTotal`, `adjustIncrease`,
    `adjustDecrease`, `transferIn`, `transferOut`, `reserved`, `actual`, `released`, and the
    resulting `available` — all base-currency decimal strings, never overwriting
    `amount_total`.
  - `GET /budgets/:id/ledger` (`BUDGET_VIEW`) → the budget's append-only `budget_txn` rows
    (type, amount, source document no, remark, createdAt), newest first — read-only.
  - **Company-scope the UI-facing budget reads**: `list` (and the new reads) restricted to the
    active company via the budget's fiscal-year/department company, so no cross-company budget
    is ever returned.
- **Budget list** (`BUDGET_VIEW`): the active company's budgets (name, GL, fiscal year,
  department, total, status) with the derived available shown per row; click → detail.
- **Budget detail** (`BUDGET_VIEW`): a breakdown card (total → +adjust/±transfer → −reserved
  − actual + released = available, formatted to the currency's decimal places) and the ledger
  table; each ledger row links to its source document when present.
- **Shell integration**: a "Budgets" nav entry (gated by `BUDGET_VIEW`); a typed
  `api/budgets.ts` + a small Pinia store; amounts formatted via the currency's
  `decimal_places`, never a JS number.
- **Tests**: backend tests for breakdown math and the ledger read (and that a cross-company
  budget is not returned); frontend unit tests for the budgets store and a pure
  balance-breakdown formatting/derivation helper.

## Capabilities

### New Capabilities
- `web-budgets`: the Vue budget list and detail screens — derived balance breakdown and the
  append-only ledger, permission-gated and company-scoped.

### Modified Capabilities
- `budget-control`: adds a derived-balance **breakdown** read and an append-only **ledger**
  read, and scopes the UI-facing budget listing to the active company. The derived-balance and
  append-only invariants are unchanged; this only exposes more read detail and tightens
  isolation.

## Impact

- **Affected**: `front-end/` (new views/store/api, router/nav) and
  `back/src/modules/budget/` (a `breakdown` method, two controller reads, company-scoped
  list) with tests.
- **Invariants reflected**: 3 (balance and breakdown derived from `budget_txn`, never
  overwriting `amount_total`); 2 (the ledger read is strictly read-only); 1 (budget reads
  scoped to the active company); 5 (gated by `BUDGET_VIEW`); 6 (amounts in base currency,
  formatted by `decimal_places`).
- **Consumes**: existing `GET /budgets`, `GET /budgets/:id`, `GET /budgets/:id/balance`, plus
  the new `…/breakdown` and `…/ledger`.
- **No schema change**; no new dependency (`decimal.js` already added for the frontend).

## Out of Scope

- Creating / editing budgets, transfers, and adjustments from the UI (`BUDGET_MANAGE`
  write screens) — a later `web-budget-admin` slice; this change is read-only.
- Quota balances/usage screens — `web-quota`.
- Cross-fiscal-year roll-forward and budget vs. actual reporting/charts — later analytics.
- Changing the existing `GET /budgets/:id/balance` contract (kept as-is; breakdown is a new,
  separate read).
