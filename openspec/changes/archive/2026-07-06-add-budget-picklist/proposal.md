## Why

A `requires_budget` document type (e.g. PR) cannot be submitted unless every line
carries a `budget_id` (invariant 4). But today the only way to see and pick a budget —
both the backend `GET /budgets` list and the Create Document wizard's per-line budget
column — is gated by `BUDGET_VIEW`, the permission designed to expose budget **balances,
breakdowns, and ledgers** (finance-officer data). This forces every requester of a
budget-controlled document to be granted full `BUDGET_VIEW`, over-exposing sensitive
financial figures just so they can select which budget a line charges to. Requesters end
up unable to create the very documents they are entitled to (`DOC_CREATE`), or are handed
more visibility than their role warrants.

## What Changes

- Add a minimal, read-only **budget picklist** read that returns only the fields needed to
  choose a budget on a document line — `id`, `budgetName`, `glAccount` (and enough to
  scope/label it) — and explicitly **excludes** `amount_total`, derived balance,
  breakdown, and ledger data.
- Gate the picklist on **`DOC_CREATE`** (not `BUDGET_VIEW`), scoped to the active company
  and limited to selectable (`ACTIVE`) budgets.
- Update the Create Document wizard so the per-line budget selector is populated from the
  picklist and shown to `DOC_CREATE` users, decoupled from `BUDGET_VIEW`. The balance/
  ledger reads on the Budgets pages stay gated by `BUDGET_VIEW` and are unchanged.
- Existing `GET /budgets` (full list with amounts) and all balance/breakdown/ledger reads
  remain `BUDGET_VIEW`-only — no relaxation of financial-figure exposure.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `budget-control`: add a "Selectable Budgets for Document Creation" read requirement —
  a company-scoped, balance-free budget picklist authorized by `DOC_CREATE`; clarify that
  the balance-bearing reads remain `BUDGET_VIEW`.
- `web-documents`: the Create Document wizard's per-line budget picker is populated from
  the picklist and gated by `DOC_CREATE` (for `requires_budget` types), not `BUDGET_VIEW`.

## Impact

- **Backend:** new endpoint on the budget module (e.g. `GET /budgets/selectable`) with its
  own read path returning a trimmed projection; reuses the existing company scope via
  `fiscalYear.company`. New permission gate `DOC_CREATE` on that route only.
- **Frontend:** `CreateDocumentView.vue` fetches the picklist and passes `canBudget` from
  `DOC_CREATE` (for budget-controlled types) instead of `BUDGET_VIEW`; `LineItemsEditor.vue`
  budget column unchanged in shape.
- **Invariants:** must preserve company isolation (invariant 1 — picklist scoped through
  `fiscalYear.company`) and authorize on permission codes (invariant 6). Must not become a
  side channel for balance data — projection excludes all amount/ledger fields so
  `BUDGET_VIEW`'s protection is intact.
- **No data-model change** — no new tables/columns; `document_line.budget_id` already exists.
