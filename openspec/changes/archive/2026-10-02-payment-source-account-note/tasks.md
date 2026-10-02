## 1. Data model

- [x] 1.1 Add `transfer_from` to `payment` in `erp_approval_system.dbml`, noting it is a stated fact
      and not a reference to `bank_account`
- [x] 1.2 Declare `TRANSFER_SOURCES` (`PRIMARY` / `RESERVE`) in `shared/src/index.ts` beside
      `PAYMENT_METHODS`
- [x] 1.3 Add the property to the `Payment` entity with a CHECK over the closed pair
- [x] 1.4 Write the migration (one nullable column + the CHECK)

## 2. Backend

- [x] 2.1 Accept `transferFrom` on `RecordPaymentDto`
- [x] 2.2 Enforce it in `PaymentService.record`: a HAND-recorded transfer requires it, cash stores
      none, an unknown value is refused by name. A batch import is exempt — its payments already
      name the run's configured `bank_account`, and requiring this too would refuse every import.
- [x] 2.3 Add `lockedRate` (the document's stamped `exchange_rate`) to the payable-handoff payload
- [x] 2.4 Return `transferFrom` from the payment read surfaces
- [x] 2.5 Unit tests: transfer with and without the choice, cash without it, unknown value, the
      queue reporting the locked rate, and a text-only payment still listed as unattributed

## 3. Frontend

- [x] 3.1 Add the main/reserve RadioButton pair to the record dialog, shown only for a transfer
- [x] 3.2 Pre-fill the actual-rate field from the row's `lockedRate` when the dialog opens
- [x] 3.3 Extend `canConfirm` so a transfer cannot be submitted without the choice
- [x] 3.4 Send `transferFrom` through `paymentsApi` / the payments store
- [x] 3.5 Show the choice wherever a recorded payment is read back
- [x] 3.6 i18n keys in `en`, `la`, `zh`
- [x] 3.7 Component tests: the pair appears for transfer and vanishes for cash; confirm is disabled
      until chosen; the rate arrives pre-filled and an edited rate is what gets sent

## 5. Ask on the slip, not (only) on the record form

Corrected after seeing the real flow: the money goes out, finance attaches the transfer slip at the
approval step that demands one, and states the account there. The record-payment screen is cleared
later, often by someone else, who can only guess.

- [x] 5.1 `payment_attachment.transfer_from` — column, entity property, CHECK, same migration
- [x] 5.2 `PaymentAttachmentService.upload` accepts and stores it; `list` returns it; a value outside
      the pair is refused by name
- [x] 5.3 `PaymentService.record` adopts the newest slip that states one when the request states
      none; the request's own value still wins; a transfer nobody has said anything about is still
      refused
- [x] 5.4 `PayableHandoff.statedTransferFrom` so the record form arrives pre-answered
- [x] 5.5 `PaymentSlips.vue`: the radio pair beside the attach control, upload blocked until chosen
      with the reason stated, carried forward from an earlier slip, each slip's statement shown
- [x] 5.6 i18n for the new hint in `en`, `la`, `zh`
- [x] 5.7 Tests: slip stores/refuses, payment adopts, newest slip wins, request overrides, queue
      carries it, silent slip still refused; component tests for the panel

## 6. The rate on the slip, and the flow ending there

The rate the bank actually gave is on the slip too, and once the slip states the account and the
rate there is nothing left for anyone to type: the payment records itself when the document
completes.

- [x] 6.1 `payment_attachment.actual_rate` numeric(18,8) — column, entity property, same migration
- [x] 6.2 `PaymentAttachmentService.upload` accepts and stores it; a non-positive rate is refused
      before the file reaches storage; `list` returns it
- [x] 6.3 `RecordPaymentDto.actualRate` becomes optional; `PaymentService.record` adopts the newest
      slip's rate and refuses when neither it nor the request states one
- [x] 6.4 `PaymentService.recordFromSlip` — records only a complete statement, at most once, and
      returns null (leaving the manual queue) otherwise
- [x] 6.5 `PaymentHandoffListener` records off `payment.ready`; logs, never propagates
- [x] 6.6 `PayableHandoff.statedActualRate`; the record dialog pre-fills from it, else `lockedRate`
- [x] 6.7 `PaymentSlips.vue`: the rate field started from a new `lockedRate` prop, upload blocked
      until the account is chosen AND the rate is positive, each slip's rate shown; the prop passed
      from the approval dialog, the document detail and the record confirmation
- [x] 6.8 i18n for the rate hint in `en`, `la`, `zh`
- [x] 6.9 Tests: slip stores/refuses the rate, record adopts and overrides it, refusal with no rate
      anywhere, queue carries it, self-recording end to end (records once, leaves half-statements,
      writes no `budget_txn`), component tests for the rate field

## 7. Readable rate, and the budget in front of the person deciding

- [x] 7.1 `formatRate` — drop the scale NUMERIC(18,8) reads back with, to two decimals, zeros only
      and never rounding (`23000.00000000` → `23000.00`, `0.00003450` → `0.0000345`)
- [x] 7.2 Use it wherever a rate is shown: the slip panel's field and per-slip line, the record
      dialog's field, the document-detail exchange-rate tile
- [x] 7.3 `DocumentService.detail` reports the budgets the document charges — name, appropriation,
      derived available balance, and this document's own hold (Σ RESERVE − Σ RELEASE), batched
- [x] 7.4 `BudgetService.availableFor` exposes the ONE balance derivation rather than a second one
- [x] 7.5 The approval dialog renders it above the slip block, one row per budget, marking a pot
      already overdrawn
- [x] 7.6 i18n in `en`, `la`, `zh`
- [x] 7.7 Tests: the formatter's cases; detail reports/sums/omits budgets and a draft holds nothing;
      the dialog shows, hides, repeats and marks
- [x] 7.8 A Budget column on the document's line-items table, beside the GL account column — named
      from the detail response's budget list so the column and the panel cannot disagree, hidden
      when no line charges one, a dash for a line that charges none

## 4. Verification

- [x] 4.1 Run the backend and frontend suites
- [ ] 4.2 Record one transfer and one cash payment against a real owed document and read them back
