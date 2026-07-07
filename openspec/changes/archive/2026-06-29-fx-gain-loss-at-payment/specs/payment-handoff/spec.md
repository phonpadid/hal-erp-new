## ADDED Requirements

### Requirement: Record Payment and FX Gain/Loss

The system SHALL let a `PAYMENT_MANAGE` user record a payment against a settled disbursement (a
`COMPLETED` document whose type `post_action` is `CUT_BUDGET`) at an actual exchange rate, persisting
one `payment` record per disbursement (unique on `document_id`, company-scoped). The record SHALL
capture the locked rate, the actual rate, the base-locked amount (`document.base_total_amount`), the
base-actual amount (`document.total_amount × actual_rate`, rounded to the base currency
`decimal_places`), the FX delta (`base_actual − base_locked`), and its kind (`LOSS` when the delta is
positive, `GAIN` when negative, else `NONE`). On record the system SHALL emit a `payment.settled`
event carrying that breakdown for external accounting, and MUST NOT write any `budget_txn` — the
budget `ACTUAL` stays at the locked basis (invariant 6). Recording a payment for a disbursement that
already has one SHALL be rejected.

#### Scenario: Paying at a worse rate records an FX loss

- **GIVEN** a settled disbursement locked at rate 1.0 with a base total of 100000
- **WHEN** a `PAYMENT_MANAGE` user records the payment at an actual rate giving a base-actual of 105000
- **THEN** a `payment` row is created with `fx_delta` 5000 and kind `LOSS`, a `payment.settled` event is
  emitted, and no `budget_txn` is written

#### Scenario: Paying in the base currency has no FX

- **WHEN** a disbursement already in the base currency is paid
- **THEN** the FX delta is 0 and the kind is `NONE`, and the disbursement is marked paid

#### Scenario: A disbursement cannot be paid twice

- **GIVEN** a disbursement that already has a payment record
- **WHEN** recording a payment for it again
- **THEN** the second record is rejected (one payment per disbursement)

## MODIFIED Requirements

### Requirement: Ready-to-Pay Queue

The system SHALL expose a read-only, company-scoped, `PAYMENT_VIEW`-gated ready-to-pay queue derived
from `COMPLETED` documents whose type `post_action` is `CUT_BUDGET` that do **not** yet have a
`payment` record, listing the document, vendor, settled base amount (the document's base total —
equal to the actual posted to the budget), and GL account(s), so an external accounting system can
pull payables. The queue SHALL be derived, not stored, and SHALL respect company isolation.

#### Scenario: Settled disbursement appears in the queue

- **GIVEN** a settled `CUT_BUDGET` document in the active company with no payment yet
- **WHEN** a `PAYMENT_VIEW` user reads the ready-to-pay queue
- **THEN** the document appears with its vendor, base actual amount, and GL

#### Scenario: A paid disbursement leaves the queue

- **GIVEN** a settled disbursement that has been recorded as paid
- **WHEN** the ready-to-pay queue is read
- **THEN** that disbursement is no longer listed

#### Scenario: Queue is company-scoped

- **WHEN** the queue is read in one company
- **THEN** another company's settled documents are not listed
