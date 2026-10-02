## Why

When finance records a payment, nothing says **which of the company's own accounts the money went
out of**. The company runs a main account and a reserve account, and which one paid is a fact
somebody confirms at the moment of paying — the head who signs and the accountant who checks the
month both ask it, and today the answer is not in the system at all.

The rate the money actually converted at is also finance's to state, not the requester's. The form
asks for it, but as an empty box: the person paying has to know the document's locked rate and type
it again, when what they are doing is confirming or correcting a figure the document already carries.

## What Changes

- The **transfer-slip panel** gains a **main account / reserve account** choice, offered as two radio
  buttons, and an **actual exchange rate** field. Both are asked there because that is where the
  answers are known — finance attaches the slip at the approval step that demands one, which in this
  company is the moment the money actually goes out, and the bank's rate for that day is on the slip
  in their hand. No slip can be attached until both are answered.
- The rate field starts at the rate **locked on the document**, so finance corrects a figure instead
  of retyping one. What they submit is what gets recorded; the server substitutes nothing.
- When the document then **completes, the payment records itself** from what the slip stated. That is
  where the process actually ends in the business, and nobody retypes facts the person who paid has
  already given.
- The record-payment form stays as the **fallback** for documents that state less than both — a cash
  payment, or a slip that predates these fields — and arrives with whatever the slip did say already
  filled in.
- It is asked only for a **transfer**. Cash did not leave a bank account, so nothing asks which one
  it left.
- The stored choice is shown wherever a recorded payment or its slip is read.

Deliberately NOT in this change:

- **The payee's account number.** The requester already names the destination on the document, and
  the queue already carries it (`payee.bankCode` / `accountNo` / `accountName`). Asking finance to
  type it again would be a second copy of a fact the system already holds, and the two would
  disagree the first time somebody mistyped one.
- **The company's bank accounts as master data.** `bank_account` exists as a table and
  `payment.bank_account_id` as a column, and the `payment-handoff` spec already says a
  singly-recorded payment may name one — but that table holds no rows in practice, so making the
  form depend on it would block finance behind a data-entry project. The radio records what finance
  can state today; the `unattributed()` report keeps counting these payments until real accounts are
  entered, which is honest — "the reserve one" is not a link to a configured account.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `payment-handoff`: the transfer slip captures which account the money left and the rate it
  converted at; a completed document records its own payment from that statement; the recorded
  payment adopts what it did not state; and the ready-to-pay queue carries the statement and each
  document's locked rate so the fallback form arrives pre-filled.
- `web-payments`: the slip panel asks both questions, and the record form becomes the fallback rather
  than the route.

## Impact

- **Data model**: `erp_approval_system.dbml` — `transfer_from` on `payment` and on
  `payment_attachment`, plus `actual_rate` on `payment_attachment`; one migration; no ledger table
  touched.
- **Backend**: `RecordPaymentDto` (`actualRate` becomes optional) and a new `AttachSlipDto`,
  `PaymentAttachmentService.upload`, `PaymentService.record` (adoption) and a new
  `PaymentService.recordFromSlip`, `PaymentHandoffListener` on `payment.ready`, the payable-handoff
  payload (add `lockedRate`, `statedTransferFrom`, `statedActualRate`), the payment and slip read
  surfaces.
- **Frontend**: `PaymentSlips.vue` (where the question is asked — it appears in the approval dialog,
  the document detail and the record confirmation), the record-payment dialog in `ReadyToPayView.vue`,
  the unattributed panel in `BankReconciliationView.vue`, plus i18n in three locales.
- **Invariants**: none at risk. Recording a payment already writes no `budget_txn` (invariants 3 and
  6 untouched), and recording it automatically goes through the same `record` path rather than a
  second way to write the row. The locked rate is read from the document, never recomputed (invariant
  6: the rate stamped at submit stands); the actual rate is what a person stated, never what the
  server inferred. Company scope is unchanged — the listener runs in the completing request's
  context, and authorisation happened at the slip, which requires `PAYMENT_MANAGE`.
