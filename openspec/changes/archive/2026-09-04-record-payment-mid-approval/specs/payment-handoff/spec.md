## MODIFIED Requirements

### Requirement: Record Payment and FX Gain/Loss

The system SHALL let a `PAYMENT_MANAGE` user record a payment against any document the company owes and has not paid — the same set the ready-to-pay queue lists, by the same predicate — persisting one `payment` record per document (unique on `document_id`, company-scoped). One act, one endpoint and one permission SHALL cover every payee: what differs between paying a supplier and paying a person is who is owed, not how the company records that money left.

The queue and the record SHALL agree by construction: a document the queue offers SHALL be recordable, and one it does not offer SHALL be refused. A queue that lists what cannot be acted on, or an endpoint that accepts what was never listed, is the defect this change exists to remove.

The system SHALL additionally let a `PAYMENT_MANAGE` user record a payment against a document that is `IN_APPROVAL`, when the document's current approval step (`document_approval_step` at `current_step_no`) has `requires_payment_slip` true and a `payment_attachment` already exists for the document. This is the only precondition under which an `IN_APPROVAL` document is recordable; it does not appear in and does not need to appear in the ready-to-pay queue, which lists unpaid obligations, not recordability.

The record SHALL capture the locked rate, the actual rate, the base-locked amount (`document.base_total_amount`), the base-actual amount (`document.total_amount × actual_rate`, rounded to the base currency `decimal_places`), the FX delta (`base_actual − base_locked`), and its kind (`LOSS` when the delta is positive, `GAIN` when negative, else `NONE`).

The record SHALL additionally capture the **method** the money moved by, a **reference**, and a **note**. The method SHALL distinguish at minimum cash from a bank transfer, because it decides whether evidence is required and explains a bank credit that never had a file behind it. An unsupported method SHALL be refused with an error naming it, rather than being treated as any other.

The record MAY carry a withholding-tax `tax_code` (`kind` = `WHT`); when present the system SHALL compute and store `wht_amount` (on the pre-VAT net base) and pay the payee net of `wht_amount`. Withholding SHALL be available whoever the payee is — a payment to an individual for services is subject to it in the same way a payment to a company is.

The ledger effect SHALL clear the payable the accrual actually raised, read from that accrual's own credit line rather than from a configured account, so that a trade payable and a claim payable are each cleared by the account they were raised in without the payment path knowing which is which.

On record the system MUST NOT write any `budget_txn`, regardless of the document's status — the budget `ACTUAL` stays at the locked basis (invariant 6) and is produced only by the document's own settlement, not by recording its payment. Recording a payment for a document that already has one SHALL be rejected.

If the document is already `COMPLETED` at the time of recording, the system SHALL emit a `payment.settled` event immediately, exactly as before. If the document is `IN_APPROVAL` (the new case above), the system SHALL persist the `payment` row but SHALL NOT emit `payment.settled` yet — that event depends on the `budget_txn` ACTUAL row the document's own settlement produces on full approval, which does not exist yet. `payment.settled` for that row is instead emitted when the document later reaches `COMPLETED` (see `approval-workflow`'s settlement handling), reusing the existing row rather than requiring a second `record()` call.

#### Scenario: Paying at a worse rate records an FX loss

- **GIVEN** a settled disbursement locked at rate 1.0 with a base total of 100000
- **WHEN** a `PAYMENT_MANAGE` user records the payment at an actual rate giving a base-actual of 105000
- **THEN** a `payment` row is created with `fx_delta` 5000 and kind `LOSS`, a `payment.settled` event is
  emitted, and no `budget_txn` is written

#### Scenario: Paying in the base currency has no FX

- **WHEN** a disbursement already in the base currency is paid
- **THEN** the FX delta is 0 and the kind is `NONE`, and the disbursement is marked paid

#### Scenario: Recording a payment with WHT pays the vendor net

- **GIVEN** a settled disbursement with a base actual of 100000 paid with a 3% WHT code
- **THEN** the `payment` stores `wht_amount` 3000 and the vendor is paid 97000

#### Scenario: A claim is paid by the same act

- **GIVEN** a fully approved document with no vendor whose accrual raised a claim payable
- **WHEN** a `PAYMENT_MANAGE` user records a cash payment against it with a reference and a date
- **THEN** one `payment` row is stored with that method, reference and actor, and the entry debits the claim payable and credits cash-clearing

#### Scenario: The payable cleared is the one the accrual raised

- **GIVEN** two paid documents, one whose accrual credited the trade payable and one whose accrual credited the claim payable
- **WHEN** their payments post
- **THEN** each entry debits the account its own accrual credited, with no account configured on the payment path

#### Scenario: Withholding is available on a payment to a person

- **GIVEN** a claim payable to an individual for services
- **WHEN** it is paid with a WHT code
- **THEN** `wht_amount` is stored and the payee is paid net, as for any other payee

#### Scenario: An unsupported method is named, not assumed

- **WHEN** a payment is recorded with a method the system does not support
- **THEN** the request is rejected with an error naming that method

#### Scenario: A disbursement cannot be paid twice

- **GIVEN** a disbursement that already has a payment record
- **WHEN** recording a payment for it again
- **THEN** the second record is rejected (one payment per disbursement)

#### Scenario: A gated step in flight can be recorded early

- **GIVEN** a document `IN_APPROVAL` whose current step has `requires_payment_slip` true and already has a `payment_attachment`
- **WHEN** a `PAYMENT_MANAGE` user records the payment
- **THEN** a `payment` row is created capturing rate, method, reference and FX exactly as for a completed document
- **AND** no `budget_txn` is written
- **AND** no `payment.settled` event is emitted yet

#### Scenario: A step not yet requiring evidence cannot be recorded early

- **GIVEN** a document `IN_APPROVAL` whose current step does not have `requires_payment_slip` true
- **WHEN** a `PAYMENT_MANAGE` user attempts to record a payment against it
- **THEN** the request is refused, exactly as for any other document that is neither fully approved nor at a gated step

#### Scenario: A gated step with no evidence yet cannot be recorded early

- **GIVEN** a document `IN_APPROVAL` whose current step has `requires_payment_slip` true but no `payment_attachment` exists yet
- **WHEN** a `PAYMENT_MANAGE` user attempts to record a payment against it
- **THEN** the request is refused

#### Scenario: Reaching full approval settles an already-recorded payment

- **GIVEN** a document with a `payment` row recorded early at its gated step, now on its final step
- **WHEN** the final step approves and the document becomes `COMPLETED`
- **THEN** the existing `CUT_BUDGET` settlement runs as normal, producing the `budget_txn` ACTUAL/RELEASE rows
- **AND** `payment.settled` is emitted for the existing `payment` row rather than requiring a new one
- **AND** the document does not appear in the ready-to-pay queue, exactly as any other paid, completed document does not
