## 1. Room in the audit trail

- [x] 1.1 Add `RESTATE_RATE` to `ApproveAction` (`back/src/common/enums/index.ts`), and keep it out of
      the actions the approval endpoint accepts — the treatment `ESCALATE` already has
- [x] 1.2 Migration: widen `approval_log_action_check` to admit it; `down()` re-narrows it
- [x] 1.3 Note the new action beside `approval_log` in `erp_approval_system.dbml`

## 2. Restating the rate

- [x] 2.1 `DocumentRateService.restate(documentId, rate)` — one `em.transactional` unit holding the
      budget's `PESSIMISTIC_WRITE` lock across everything below
- [x] 2.2 Refusals first, by name, before anything is written: not `IN_APPROVAL`; every approval step
      already decided; a payment exists. Re-read them inside the transaction as `record` does
- [x] 2.3 Recompute `document.exchange_rate`, `base_total_amount` and each line's `base_line_amount`
      from the stated rate
- [x] 2.4 Recompute the budget base ONLY when the pair has no `BUDGET_RATE`, deciding it the same way
      `document-submit.service.ts:349-356` does, so restating cannot change which rate governs the budget
- [x] 2.5 Re-reserve: `BudgetLedgerService.releaseAll` then `reserve` with the recomputed lines,
      inside the same transaction — coverage and the over-limit policy come from `reserve` unchanged
- [x] 2.6 Write the `approval_log` row: the acting user, the step the document is waiting on, the
      before and after rates in `remark`
- [x] 2.7 Unit tests: the document is restated; the ledger gains RELEASE+RESERVE and never an update;
      a `BUDGET_RATE`-configured pair leaves the reservation untouched; an over-`HARD_STOP`
      restatement is refused and writes nothing; each refusal condition refuses by name; the log row
      carries both rates
- [x] 2.8 Concurrency test: two restatements against one budget with room for one — one wins, the
      budget is never over-committed

## 3. Reaching it

- [x] 3.1 `POST /payments/:documentId/rate` under `PAYMENT_MANAGE`, taking the rate alone
- [x] 3.2 `PaymentAttachmentService.upload` calls the same service method when a slip carries a rate,
      so the two entries cannot diverge
- [x] 3.3 The ready-to-pay row and the document detail carry whether the rate can still be restated,
      so the screen can withdraw the control rather than discover the refusal
- [x] 3.4 Tests: the route restates without a file; a slip upload still restates; both refuse in the
      same cases

## 4. The screen

- [x] 4.1 `PaymentSlips.vue`: the rate becomes its own field with its own save, showing whether what
      is on screen is stored
- [x] 4.2 State the effect before it is applied — what the document will be worth, and what happens
      to the budget — and say "unchanged" when the rate matches
- [x] 4.3 Withdraw the control, with the reason, once the document is past its last approval or has a
      payment; keep showing what was stated
- [x] 4.4 i18n in `en`, `la`, `zh`
- [x] 4.5 Component tests: saving without a file; the unsaved state is visible; the effect is shown
      before saving; the control is gone and explained in each refused case

## 5. Verification

- [x] 5.1 Backend and frontend suites, `tsc -p tsconfig.build.json` and `vue-tsc -b` — backend
      2114 passed, frontend 1117 passed, both typechecks clean
- [x] 5.2 On a real document at a step before the last: state a rate, and confirm the document, the
      ledger (RELEASE + RESERVE), and the approval log all agree — verified on REC-HAL-2026-0004,
      0005 and 0006: RESERVE → RELEASE → RESERVE at the restated rate, each with its RESTATE_RATE
      log row naming both figures
- [x] 5.3 Approve it to completion and confirm the payment records at that rate with an FX difference
      of zero — REC-HAL-2026-0006 recorded itself PRIMARY @ 23000, base 253,000, FX NONE 0.00
- [ ] 5.4 Confirm a completed document and a paid document both refuse, and that their screens do not
      offer the control
