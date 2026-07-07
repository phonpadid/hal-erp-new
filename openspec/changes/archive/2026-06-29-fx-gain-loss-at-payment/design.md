## Context

A disbursement is a `COMPLETED` document whose type `post_action` is `CUT_BUDGET`; on approval it
settles the reserving PR's reservation to an `ACTUAL` at the **locked** base amount
(`document.base_total_amount`, derived from `document.exchange_rate` stamped at submit). The
`payment-handoff` module already derives a ready-to-pay queue and emits `payment.ready` on settle,
but there is no actual-payment step. The locked rate and the actual paid rate differ in practice;
that delta is an accounting FX gain/loss that MUST NOT move the budget (invariant 6). Today nothing
records it, and the queue can't show a disbursement as paid.

There is no `payment`/GL table in the 37-table model. The user chose the lightweight **payment
record** approach (not a new append-only ledger): one row per disbursement capturing the FX
breakdown, consumed by external accounting via an event.

## Goals / Non-Goals

**Goals:**
- Record a payment at the actual rate, compute the FX delta, persist it, and emit it for accounting.
- Keep budget `ACTUAL` at the locked basis — no `budget_txn` for FX.
- Make the ready-to-pay queue reflect paid state.

**Non-Goals:**
- No partial/multiple payments, no reversal, no in-system GL posting or journal.
- No change to budget math, settlement, or the reserve→actual→release flow.

## Decisions

**1. New `payment` record table (not a ledger).** Add `payment` (company-scoped, **unique on
`document_id`** → one payment per disbursement): `locked_rate`, `actual_rate`, `base_locked`,
`base_actual`, `fx_delta`, `fx_kind` (`GAIN`/`LOSS`/`NONE`), `paid_at`, `created_by`. It records the
payment + FX breakdown for audit and for accounting to pull; it is not append-only/correctable here
(reversal is out of scope). Added to the DBML + a MikroORM entity + migration. Chosen over reusing
`budget_txn` (forbidden — FX must not touch the budget) and over a full AP/GL ledger (out of scope).

**2. FX delta is derived from the document, computed once at record time.** `base_actual = round(
document.total_amount × actual_rate, base_currency.decimal_places)`; `base_locked =
document.base_total_amount`; `fx_delta = base_actual − base_locked`; `fx_kind = LOSS` when `fx_delta
> 0` (paid more base than locked), `GAIN` when `< 0`, else `NONE`. All via `Money` (Decimal/string,
never a float). `locked_rate` is copied from `document.exchange_rate` for the record. The values are
persisted (not re-derived later) so the accounting record is stable.

**3. Record action gated + validated.** `POST /payments/:documentId` (`PAYMENT_MANAGE`) accepts
`{ actualRate }` (decimal string), asserts the document is the active company's `COMPLETED`
disbursement (`document_type.post_action = CUT_BUDGET`) with no existing payment, computes the
breakdown, persists the `payment`, and emits `payment.settled` (documentId, rates, base amounts,
fxDelta, kind). The existing `payment.ready` (emitted on settle) is unchanged. The read queue stays
`PAYMENT_VIEW`.

**4. Queue excludes paid disbursements.** `PaymentHandoffService.readyToPay()` left-excludes
documents that have a `payment` row, so the queue is what's still owed. Derived as before, plus the
exclusion — still no stored queue.

## Risks / Trade-offs

- [Concurrent double-record of the same payment] → The `unique(document_id)` constraint makes a
  second insert fail; the service wraps the read-check + insert in `em.transactional()` and surfaces
  a clear "already paid" error. Sequence note: this transaction writes only the `payment` row — it
  touches **no** `budget_txn`/`quota_usage`, so it pairs with nothing in the budget ledger; the
  boundary exists solely to make the not-paid check and the insert atomic under the unique key.
- [FX rounding] → Round `base_actual` to the base currency `decimal_places` with `Money`; `fx_delta`
  is the difference of two base-rounded amounts, so it carries no sub-unit drift.
- [Paying in the base currency] → `actual_rate` 1 and `base_actual = total` ⇒ `fx_delta` 0,
  `fx_kind = NONE`; the row still marks the disbursement paid.
- [Budget breach from a worse rate] → Out of scope to auto-post; the FX delta is reported separately
  and budget stays at the locked basis, matching the spec's "reported separately" intent.

## Migration Plan

Add the `payment` table via a MikroORM migration (no backfill — new concept). Seed the
`PAYMENT_MANAGE` permission + role grant. Rollback drops the table; no other data is affected.

## Open Questions

- Whether `actual_rate` or the actual paid base amount is the better input — default to `actual_rate`
  (consistent with how documents lock a rate); the base amount is then derived and auditable.
