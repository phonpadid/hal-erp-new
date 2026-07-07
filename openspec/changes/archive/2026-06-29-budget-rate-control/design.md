## Context

`DocumentSubmitService.submit` resolves one rate — `resolveRate({ from, to, asOf, companyId })` with
no `rateType`, so it defaults to `DAILY` — and stamps `exchange_rate` + `base_total_amount` +
`base_line_amount`, reserving budget at that daily base. `ApprovalRoutingService` (via
`WorkflowStepResolver.applicableSteps`) compares `document.base_total_amount` to the step amount
bands; `PostActionService.cutBudget` settles using `document_line.base_line_amount`. The
`ExchangeRateService` already resolves a `BUDGET_RATE` rate type (identity → company override → group
→ inverse). The just-shipped payment FX gain/loss compares the actual paid rate to the daily
`base_total_amount`. Constraints: money is decimal/string; the daily rate stays locked (invariant 6);
reserve and settle must use the **same** basis so the ledger balances.

## Goals / Non-Goals

**Goals:**
- Budget reservation, settlement, and approval-threshold comparison use a `BUDGET_RATE` budget base.
- The document still records the daily rate (display + payment FX).
- Fall back to the daily rate when no `BUDGET_RATE` exists, so submit never breaks.

**Non-Goals:**
- No per-type rate selection; no re-pricing of existing reservations; no change to `budget_txn`,
  the payment FX, or the daily-rate locking.

## Decisions

**1. Persist a budget base, don't re-derive.** Add `document.budget_exchange_rate`,
`document.budget_base_total_amount`, and `document_line.budget_base_line_amount` (decimal, nullable).
At submit, resolve `BUDGET_RATE` once and stamp these next to the daily fields, so reservation (at
submit) and settlement (at approval, possibly much later) read the identical, audit-stable basis.
Chosen over re-resolving at settle time (fragile, and a `BUDGET_RATE` added between submit and
approval would unbalance reserve vs actual).

**2. `BUDGET_RATE` with a daily fallback.** `submit` resolves the daily rate as today, then resolves
the budget rate via `resolveRate({ from, to, asOf, companyId, rateType: 'BUDGET_RATE' })`; if that
throws (no such rate for the pair/date), it reuses the daily rate. Same-currency documents resolve to
identity (rate 1) for both, so they're unaffected. The budget base is then
`round(amount × budgetRate, baseDp)` per line and for the total.

**3. Reserve and settle on the budget base.** `reserveLines` use `budget_base_line_amount` instead of
the daily base; `cutBudget` aggregates `budget_base_line_amount` per budget when settling the
reserving ancestor. Because both sides use the same persisted budget base, the reserve→actual→release
arithmetic stays exact.

**4. Approval thresholds on the budget base.** `WorkflowStepResolver.applicableSteps` compares
`document.budget_base_total_amount ?? document.base_total_amount` (fallback keeps older documents and
same-currency cases working) to the step bands. Bands remain expressed in the company base currency.

## Risks / Trade-offs

- [Reserve at budget base, settle at daily base would unbalance the ledger] → Both now read the same
  persisted `budget_base_line_amount`; a focused test asserts a foreign-currency PR reserves and
  settles to zero outstanding at the budget rate. Sequence note: `reserve` (submit) and `settle`
  (cutBudget) both write `budget_txn` using the budget base under the existing pessimistic budget lock
  + `em.transactional()`; no new locking is introduced.
- [No `BUDGET_RATE` configured] → Fallback to the daily rate; the budget base equals the daily base,
  i.e. exactly today's behaviour — a safe default, covered by a test.
- [Older documents without a budget base] → Reads fall back to `base_total_amount` /
  `base_line_amount`; nullable columns + the `?? daily` fallback make the change backward compatible.
- [Approval band crossing changes for foreign-currency docs] → Intended: a document is now banded at
  the stable budget rate, not the day's rate; documented in the spec scenarios.

## Migration Plan

Add the three nullable columns via a MikroORM migration (no backfill — older documents fall back to
the daily base). Rollback drops the columns. Seeding a `BUDGET_RATE` is optional config; absent it,
behaviour is unchanged.

## Open Questions

- None blocking. A future enhancement could surface the budget base in the document detail UI next to
  the daily base; out of scope here.
