## Why

Multi-currency locks the FX rate on a document at submit and settles budget at that locked basis,
so the budget is never moved by later FX swings (invariant 6). But when the disbursement is actually
paid — often at a different rate than was locked — nothing records that difference. The
`multi-currency` "FX Difference Goes to Accounting" requirement is specified but unimplemented: there
is no way to record an actual payment, compute the FX gain/loss, or hand it to accounting, and the
ready-to-pay queue can never show a disbursement as paid. This closes that gap.

## What Changes

- **Record an actual payment.** A new `PAYMENT_MANAGE` action records a payment against a settled
  disbursement (a `COMPLETED` `CUT_BUDGET` document) at its **actual** rate, persisting a `payment`
  record: locked rate, actual rate, base-locked amount, base-actual amount, the FX delta, and its
  kind (`GAIN` / `LOSS` / `NONE`). One payment per disbursement.
- **FX delta to accounting, never to budget.** The FX delta SHALL be computed as
  `base_actual − base_locked` (base_actual = the doc-currency total × actual rate, rounded to the base
  currency `decimal_places`) and reported via a `payment.settled` event for an external accounting
  system. Budget `ACTUAL` stays at the locked basis — **no `budget_txn` is written for FX**.
- **Queue reflects paid state.** The ready-to-pay queue SHALL exclude disbursements that already have
  a payment record, so accounting sees only what is still owed.
- **Web.** The ready-to-pay list gains a *Record payment* action (enter the actual rate) that shows
  the resulting FX gain/loss and removes the row from the queue.

## Capabilities

### New Capabilities
<!-- None — extends existing capabilities; adds one record table within payment-handoff. -->

### Modified Capabilities
- `payment-handoff`: add the `payment` record + a `PAYMENT_MANAGE` record-payment action that computes
  the FX delta and emits `payment.settled`; the ready-to-pay queue excludes paid disbursements.
- `multi-currency`: implement "FX Difference Goes to Accounting" — recording a payment at a different
  rate posts the FX delta to accounting (via the handoff) and leaves the budget at the locked basis.
- `web-payments`: the ready-to-pay list gains a record-payment action and shows FX gain/loss.

## Impact

- **Data model:** one new table `payment` (company-scoped, unique on `document_id`) holding the FX
  breakdown — added to `erp_approval_system.dbml`, with a MikroORM entity + migration. **No change to
  `budget_txn`** (FX never touches the budget ledger).
- **Backend:** `payment-handoff` module — a `PaymentService.record()` + `POST /payments/:documentId`
  (`PAYMENT_MANAGE`), the `payment.settled` event, and a queue filter excluding paid docs. New
  permission `PAYMENT_MANAGE`; seed grant.
- **Frontend:** `front-end` — a record-payment dialog on the ready-to-pay list (actual rate → FX
  result), API client + store wiring, EN/Lao i18n.
- **Invariants:** budget balance math unchanged and FX-isolated (invariant 6); company scope on the
  payment record and queue; money as decimal/string; the record is permission-gated and the queue
  read stays `PAYMENT_VIEW`.

## Out of Scope

- Partial / multiple payments per disbursement (one payment per disbursement here), payment reversal,
  and any in-system GL posting (accounting consumes the `payment.settled` event externally).
