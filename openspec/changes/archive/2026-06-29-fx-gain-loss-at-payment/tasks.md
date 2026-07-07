## 1. Data model — payment record

- [x] 1.1 Add a `payment` table to `erp_approval_system.dbml` (company-scoped; `document_id` unique; `locked_rate`, `actual_rate` decimal(18,8); `base_locked`, `base_actual`, `fx_delta` decimal(15,2); `fx_kind` GAIN/LOSS/NONE; `paid_at`, `created_by`, `created_at`).
- [x] 1.2 Add a MikroORM `Payment` entity (company-scoped) + a migration creating the table with the unique index on `document_id`.

## 2. Backend — record payment + FX

- [x] 2.1 Add `PAYMENT_MANAGE` to the payment permissions; seed the grant.
- [x] 2.2 `PaymentService.record(documentId, { actualRate })`: in one `em.transactional()`, assert the active company's `COMPLETED` disbursement (`document_type.post_action = CUT_BUDGET`) with no existing payment; compute `base_actual = round(total × actualRate, baseDp)` (via `Money`), `fx_delta = base_actual − base_locked`, `fx_kind`; persist the `payment`; reject a second payment via the unique key. No `budget_txn` written.
- [x] 2.3 Emit `payment.settled` (documentId, lockedRate, actualRate, baseLocked, baseActual, fxDelta, kind) after commit; extend the payment-handoff listener to log/dispatch it (seam for accounting).
- [x] 2.4 Endpoint `POST /payments/:documentId` (`PAYMENT_MANAGE`, company-scoped) → `record`. DTO validates `actualRate` as a positive decimal string.
- [x] 2.5 Exclude documents that have a `payment` row from `PaymentHandoffService.readyToPay()`.
- [x] 2.6 Unit tests: paying at a worse rate records `fx_delta`/`LOSS` + emits and writes no `budget_txn`; base-currency payment → 0/`NONE`; double-pay rejected; a paid disbursement leaves the queue; company isolation.

## 3. Shared schema

- [x] 3.1 Add a shared Zod schema for the record-payment DTO (`{ actualRate: positive decimal string }`), mirrored by the backend DTO.

## 4. Frontend — record payment + FX

- [x] 4.1 Add a record-payment dialog to `ReadyToPayView.vue` (enter actual rate), gated by `PAYMENT_MANAGE`; on success show the FX gain/loss and reload the queue.
- [x] 4.2 API client + Pinia store wiring for `POST /payments/:id`; i18n (en + la).

## 5. Verification

- [x] 5.1 Backend unit tests green (`vitest`); migration applies; frontend unit tests + `vite build`.
- [ ] 5.2 Manual smoke: settle a foreign-currency disbursement, record a payment at a different rate, confirm the FX gain/loss is shown, the budget is unchanged (no FX `budget_txn`), and the disbursement leaves the ready-to-pay queue.
