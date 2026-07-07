## Why

A budget is set once for the fiscal year at a fixed planning rate (`BUDGET_RATE`), but today a
foreign-currency document reserves and settles budget — and is compared against approval thresholds —
at the **daily** rate stamped at submit. So daily FX swings whipsaw budget consumption and can push a
document across an approval band purely because the day's rate moved, even though the budget was
planned at a stable rate. The feature's intent ("อัตราตั้งงบคงที่ทั้งปี") is that **budget control and
approval thresholds use `BUDGET_RATE`**, while the document still records its daily rate for display
and for the payment FX gain/loss. The `BUDGET_RATE` rate type exists and resolves, but nothing uses it.

## What Changes

- **Budget base computed at `BUDGET_RATE`.** At submit the system SHALL resolve the `BUDGET_RATE` for
  the document currency → company base (falling back to the daily rate when no `BUDGET_RATE` exists),
  and stamp a **budget base** on the document and its lines (`budget_exchange_rate`,
  `budget_base_total_amount`, `document_line.budget_base_line_amount`) alongside the existing daily
  base.
- **Reserve / settle on the budget base.** Budget reservation at submit and conversion to actual on
  approval SHALL use the budget-base line amounts, so budget consumption is measured at the stable
  `BUDGET_RATE`, not the daily rate.
- **Approval thresholds on the budget base.** Workflow step `amount_min`/`amount_max` bands SHALL be
  compared against `budget_base_total_amount` (falling back to the daily base when absent), so routing
  is stable against daily FX.
- **Daily rate still recorded.** `exchange_rate` / `base_total_amount` / `base_line_amount` keep the
  **daily** rate, unchanged — they drive display and the payment FX gain/loss (locked vs actual).

## Capabilities

### New Capabilities
<!-- None — refines existing behaviour; adds budget-base columns. -->

### Modified Capabilities
- `multi-currency`: budget checks, reservation, and approval-threshold comparison SHALL use the
  `BUDGET_RATE` budget base (daily-rate fallback); the document records both the daily base and the
  budget base.

## Impact

- **Data model:** add `document.budget_exchange_rate`, `document.budget_base_total_amount`, and
  `document_line.budget_base_line_amount` to `erp_approval_system.dbml`, with MikroORM entity fields
  + a migration. No change to `budget_txn`.
- **Backend:** `document-submit.service` (resolve `BUDGET_RATE` + stamp the budget base + reserve at
  the budget base), `approval` (`workflow-step.resolver` compares the budget base; `post-action`
  `cutBudget` settles the budget base), reusing the existing `ExchangeRateService` (`rateType:
  'BUDGET_RATE'`). Same-currency documents are unaffected (rate 1 either way).
- **Frontend:** none required — the create-form base preview already shows the recorded daily rate;
  the budget base is an internal control basis (a future enhancement could display it).
- **Invariants:** money as decimal/string; locked daily rate unchanged (invariant 6); reserve→actual
  stays balanced because reserve and settle both use the **same** budget base; company scope and
  permission guards unchanged. The just-shipped payment FX still compares against the daily base.

## Out of Scope

- Per-document-type selection of which rate type drives the budget (budget uses `BUDGET_RATE` with a
  daily fallback for everyone here); re-pricing already-reserved budgets when a `BUDGET_RATE` is added
  later.
