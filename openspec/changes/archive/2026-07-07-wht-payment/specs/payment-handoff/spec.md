## MODIFIED Requirements

### Requirement: Record Payment and FX Gain/Loss

The system SHALL let a `PAYMENT_MANAGE` user record a payment against a settled disbursement (a
`COMPLETED` document whose type `post_action` is `CUT_BUDGET`) at an actual exchange rate, persisting
one `payment` record per disbursement (unique on `document_id`, company-scoped). The record SHALL
capture the locked rate, the actual rate, the base-locked amount (`document.base_total_amount`), the
base-actual amount (`document.total_amount × actual_rate`, rounded to the base currency
`decimal_places`), the FX delta (`base_actual − base_locked`), and its kind (`LOSS` when the delta is
positive, `GAIN` when negative, else `NONE`). The record MAY carry a withholding-tax `tax_code`
(`kind` = `WHT`); when present the system SHALL compute and store `wht_amount` (on the pre-VAT net
base) and pay the vendor net of `wht_amount`. On record the system SHALL emit a `payment.settled`
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

#### Scenario: Recording a payment with WHT pays the vendor net

- **GIVEN** a settled disbursement with a base actual of 100000 paid with a 3% WHT code
- **THEN** the `payment` stores `wht_amount` 3000 and the vendor is paid 97000

#### Scenario: A disbursement cannot be paid twice

- **GIVEN** a disbursement that already has a payment record
- **WHEN** recording a payment for it again
- **THEN** the second record is rejected (one payment per disbursement)
