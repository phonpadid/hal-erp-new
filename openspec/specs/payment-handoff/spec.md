# payment-handoff Specification

## Purpose
TBD - created by archiving change procurement-post-actions. Update Purpose after archive.
## Requirements
### Requirement: Payment-Ready Signal on Settlement

The system SHALL emit a `payment.ready` signal when a `CUT_BUDGET` document settles its reservation
to an actual on full approval, carrying the document id, vendor, base actual amount, and GL
account(s). The signal MUST NOT create any payment or ledger row beyond the existing append-only
`budget_txn` ACTUAL/RELEASE entries.

#### Scenario: Settlement emits payment-ready

- **WHEN** a `CUT_BUDGET` document settles on approval
- **THEN** a `payment.ready` signal is emitted with the document, vendor, base amount, and GL
- **AND** no new payment or ledger table is written

### Requirement: Ready-to-Pay Queue

The system SHALL expose a read-only, company-scoped, `PAYMENT_VIEW`-gated ready-to-pay queue of every obligation the company owes and has not paid, listing the document, who is owed, the payee bank account when the document names one, the amount owed, and the GL account(s), so that one queue answers what is outstanding.

A document SHALL belong in the queue when it is fully approved, has no payment record, is not held by a `DRAFT` or `EXPORTED` `payment_batch`, and the company owes it — which is true when EITHER an approval accrual credited a payable account for it, OR its type's `post_action` is `CUT_BUDGET`.

Both clauses are needed and neither subsumes the other. The ledger answers for a document whose obligation was recognised at approval, which is the only thing that can speak for a claim — its type's post-action says nothing about who is owed. The configuration answers for a document that recognises nothing until it is paid, whose expense is booked by the payment itself; there is no accrual to read, and dropping it would make a working payable unpayable.

What matters is that ONE queue answers the question. The failure this replaces was two queues built from two different flags, each blind to the other's documents and both matching some of the same ones. A single predicate with two clauses cannot produce that, whatever it reads.

Excluding documents already held by an open batch is what stops the same payable from being exported to the bank on two files; the unique constraint on `payment.document_id` catches a double only at import, after the money has already moved.

A document whose accrual raised a trade payable and one whose accrual raised a claim payable SHALL both appear, distinguished by the kind of payable rather than separated into different queues.

The queue SHALL be derived, not stored, and SHALL respect company isolation.

#### Scenario: Settled disbursement appears in the queue

- **GIVEN** a settled document in the active company whose accrual raised a trade payable and which has no payment yet
- **WHEN** a `PAYMENT_VIEW` user reads the ready-to-pay queue
- **THEN** the document appears with its vendor, payee bank account, amount owed, and GL

#### Scenario: An unpaid claim appears in the same queue

- **GIVEN** a fully approved document with no vendor whose accrual raised a claim payable and which has no payment yet
- **WHEN** the ready-to-pay queue is read
- **THEN** it appears in that queue, marked as a claim payable, and there is no second queue holding it

#### Scenario: A paid disbursement leaves the queue

- **GIVEN** a settled disbursement that has been recorded as paid
- **WHEN** the ready-to-pay queue is read
- **THEN** that disbursement is no longer listed

#### Scenario: A paid claim leaves the queue

- **GIVEN** a claim that has been recorded as paid
- **WHEN** the ready-to-pay queue is read
- **THEN** it is no longer listed

#### Scenario: A disbursement on an open batch leaves the queue

- **GIVEN** a settled disbursement held by a `DRAFT` or `EXPORTED` batch
- **WHEN** the ready-to-pay queue is read
- **THEN** that disbursement is not listed, so it cannot be batched twice

#### Scenario: A disbursement on a cancelled batch returns to the queue

- **GIVEN** a settled disbursement whose only batch was cancelled without paying it
- **WHEN** the ready-to-pay queue is read
- **THEN** that disbursement is listed again

#### Scenario: A payable that recognises nothing at approval is still listed

- **GIVEN** a fully approved, unpaid document of a `CUT_BUDGET` type that does not accrue at approval
- **WHEN** the queue is read
- **THEN** it is listed, because the company owes it whether or not a payable was booked for it

#### Scenario: One queue holds both kinds of answer

- **GIVEN** one unpaid document owed by its accrual and one owed by its post-action
- **WHEN** the queue is read
- **THEN** both are listed, and there is no second queue holding either

#### Scenario: Queue is company-scoped

- **WHEN** the queue is read in one company
- **THEN** another company's settled documents are not listed

### Requirement: Record Payment and FX Gain/Loss

The system SHALL let a `PAYMENT_MANAGE` user record a payment against any document the company owes and has not paid — the same set the ready-to-pay queue lists, by the same predicate — persisting one `payment` record per document (unique on `document_id`, company-scoped). One act, one endpoint and one permission SHALL cover every payee: what differs between paying a supplier and paying a person is who is owed, not how the company records that money left.

The queue and the record SHALL agree by construction: a document the queue offers SHALL be recordable, and one it does not offer SHALL be refused. A queue that lists what cannot be acted on, or an endpoint that accepts what was never listed, is the defect this change exists to remove.

The record SHALL capture the locked rate, the actual rate, the base-locked amount (`document.base_total_amount`), the base-actual amount (`document.total_amount × actual_rate`, rounded to the base currency `decimal_places`), the FX delta (`base_actual − base_locked`), and its kind (`LOSS` when the delta is positive, `GAIN` when negative, else `NONE`).

The record SHALL additionally capture the **method** the money moved by, a **reference**, and a **note**. The method SHALL distinguish at minimum cash from a bank transfer, because it decides whether evidence is required and explains a bank credit that never had a file behind it. An unsupported method SHALL be refused with an error naming it, rather than being treated as any other.

The record MAY carry a withholding-tax `tax_code` (`kind` = `WHT`); when present the system SHALL compute and store `wht_amount` (on the pre-VAT net base) and pay the payee net of `wht_amount`. Withholding SHALL be available whoever the payee is — a payment to an individual for services is subject to it in the same way a payment to a company is.

The ledger effect SHALL clear the payable the accrual actually raised, read from that accrual's own credit line rather than from a configured account, so that a trade payable and a claim payable are each cleared by the account they were raised in without the payment path knowing which is which.

On record the system SHALL emit a `payment.settled` event carrying that breakdown for external accounting, and MUST NOT write any `budget_txn` — the budget `ACTUAL` stays at the locked basis (invariant 6). Recording a payment for a document that already has one SHALL be rejected.

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

### Requirement: Payments Record the Batch That Produced Them

The system SHALL carry a nullable `payment.batch_id` referencing the `payment_batch` whose result import created the payment, left null for a payment recorded through the single-document endpoint. The link SHALL make every paid document traceable to the exact bank file it went out on. Setting `batch_id` SHALL NOT change how the FX delta or withholding tax is computed — both stay the responsibility of the existing record-payment path, called once per succeeded line.

#### Scenario: An imported payment names its batch

- **WHEN** a payment is created by importing a batch result
- **THEN** its `batch_id` is the batch that was imported

#### Scenario: A manually recorded payment has no batch

- **WHEN** a payment is recorded through the single-document endpoint
- **THEN** its `batch_id` is null

#### Scenario: The FX breakdown is unchanged by batching

- **GIVEN** a disbursement paid at an actual rate through a batch import
- **THEN** the `fx_delta` and `fx_kind` match what the single-document path would have recorded for the same rate

### Requirement: The Company's Bank Accounts Are Configuration

The system SHALL hold the company's own bank accounts — the bank, the account number, the currency,
and the GL account whose balance represents it — company-scoped, and SHALL gate managing them by a
permission code distinct from reading them.

A bank account SHALL name a GL `account` of the same company rather than being one: the chart of
accounts is configuration a company owns, and a bank account is a fact about the outside world.

A bank account SHALL be deactivatable rather than deleted, because payments already point at it.

#### Scenario: A bank account names its GL account

- **WHEN** a bank account is created against an account of the same company
- **THEN** it is stored with that account

#### Scenario: Another company's GL account is refused

- **WHEN** a bank account names an account of another company
- **THEN** it is rejected

#### Scenario: Managing is gated separately from reading

- **WHEN** a user without the management code creates a bank account
- **THEN** it is rejected with 403

### Requirement: A Payment Records Which Bank Account It Left From

A payment SHALL carry the company bank account the money left from. It SHALL be defaulted from the
payment's batch when the payment came from one, and SHALL be settable when a payment is recorded
singly.

It SHALL be nullable, because payments recorded before bank accounts existed have none and SHALL NOT
be given a guessed one.

#### Scenario: A batch stamps its bank account onto its payments

- **GIVEN** a payment batch naming a bank account
- **WHEN** its result is imported and payments are recorded
- **THEN** each payment carries that bank account

#### Scenario: A payment recorded singly may name one

- **WHEN** a payment is recorded outside a batch with a bank account
- **THEN** it carries it

