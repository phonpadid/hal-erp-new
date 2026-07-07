## Why

The Budget Control backend is complete and spec-aligned (reserve/actual/release,
hard/soft policy, line-level consumption, approval-gated transfer & adjustment,
append-only ledger, base-currency balances). The Vue frontend, however, only exposes
**read** screens plus a single Adjust affordance. End users still cannot *set* a budget
by dimension or raise a *transfer* from the UI — two of the capabilities the budget
feature promises — and the existing budget screens format money without honoring the
currency's `decimal_places`, which violates the project money invariant for non-2-decimal
currencies (e.g. JPY, KWD). This change closes the frontend gaps so the budget feature is
usable end-to-end, not just queryable.

## What Changes

- **Create/Edit budget screen** — a `BUDGET_MANAGE`-gated admin form to create a budget by
  dimension (fiscal year → department → GL account), set `amount_total` and the over-limit
  policy (`HARD_STOP` / `SOFT_WARNING`), and edit a budget's name/policy/status. Calls the
  existing `POST /budgets` and `PATCH /budgets/:id`. The form MUST NOT expose `amount_total`
  for edit (invariant 3 — usage is never written back over the total).
- **Budget Transfer affordance** — a `BUDGET_MANAGE`-gated dialog to raise a transfer: pick a
  source and destination budget (same company, same fiscal year), show each budget's derived
  available balance, enter an amount, and a reason. On confirm it creates the approvable
  transfer document and routes the user to it — the client never moves money directly (the
  paired TRANSFER_OUT/IN is written by the backend only on full approval).
- **Backend transfer intake (new)** — the approval-gated transfer-document creation path does
  not yet exist (adjustment has `POST /budgets/:id/adjustments` via `BudgetAdjustmentService`,
  but transfer has only the manual `POST /budgets/transfer` that writes the ledger immediately,
  bypassing approval). This change adds a `BudgetTransferService.create()` + `POST
  /budgets/transfers` (`BUDGET_MANAGE`) that creates a `BUDGET_TRANSFER` document plus its
  `budget_movement` (movementType `TRANSFER`, from/to budget, amount, reason) — no `budget_txn`
  — and seeds the `BUDGET_TRANSFER` document type (`post_action = TRANSFER`). The existing
  post-action TRANSFER path already consumes that movement on full approval.
- **Money formatting fix** — budget list and detail screens format every amount with the
  budget currency's `decimal_places` (via the existing `useFormat`/currency context),
  replacing the hardcoded 2-decimal default.
- **i18n + theming parity** — all new labels/messages added to en/la locale files with full
  parity; dialogs and forms use PrimeUI theme tokens so light/dark both render.

Create/edit and adjustment reuse existing endpoints; only the approval-gated transfer intake
is a new (small) backend addition, mirroring the adjustment intake already in place.

## Capabilities

### New Capabilities
<!-- none — all changes extend existing capabilities -->

### Modified Capabilities
- `web-budgets`: add a **Budget Create/Edit** requirement (manage-gated dimension form) and a
  **Budget Transfer Affordance** requirement (manage-gated transfer-document dialog), and
  strengthen the **Budget List** / **Budget Balance Breakdown** / **Budget Ledger View**
  requirements to require currency `decimal_places` formatting. The capability is no longer
  read-only-for-end-users; it now also carries `BUDGET_MANAGE` affordances alongside the
  existing Adjust affordance.
- `budget-control`: add a **Transfer Request Intake** requirement — an approval-gated endpoint
  that creates a `BUDGET_TRANSFER` document plus its `budget_movement` (no `budget_txn`),
  validating same-company / same-fiscal-year and distinct source≠destination at intake. This
  closes the gap where only adjustment had a document-creation path; the existing on-approval
  paired TRANSFER_OUT/IN behavior is unchanged.

## Impact

- **Frontend** (`front-end/src`): new `views/budgets/BudgetFormView.vue` (create/edit) and a
  transfer dialog (`BudgetTransferDialog.vue`); router entries `budgets/new` and
  `budgets/:id/edit` gated by `BUDGET_MANAGE`; `api/budgets.ts` gains `create`, `update`, and
  `createTransfer`; `stores/budgets.ts` gains the matching actions; list/detail money rendering
  switched to currency-aware formatting; `i18n/locales/{en,la}/budgets.ts` extended.
- **Backend** (`back/src/modules/budget`): new `BudgetTransferService.create()`,
  `CreateTransferDto`, and `POST /budgets/transfers` (`BUDGET_MANAGE`), mirroring
  `BudgetAdjustmentService`; seed a `BUDGET_TRANSFER` document type (`post_action = TRANSFER`)
  in `src/seed/seed-data.ts`. Reuses existing `POST /budgets`, `PATCH /budgets/:id`, and the
  post-action TRANSFER path. No data-model change (`budget_movement` already supports
  from/to budget + TRANSFER).
- **Invariants**: must preserve #3 (never edit `amount_total` to reflect usage), #6
  (gate on `BUDGET_MANAGE`/`BUDGET_VIEW` codes, not roles), and the money rule (string/Decimal,
  currency `decimal_places`, never a JS number on the wire). Transfer remains approval-gated —
  the client only creates the document.
- **Tests**: Vitest store/component tests for the new actions and validation; transfer/create
  flows verified against the existing backend endpoints.
