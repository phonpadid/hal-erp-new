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

**Who is owed** SHALL be read from the document: the vendor when it names one, and otherwise the
employee the document relates to. It SHALL NOT fall back to the document's author. Whoever raised a
reimbursement is frequently not whoever is owed it, and naming the wrong payee is worse than naming
none — an entry with an empty payee tells finance to go and find out, while a wrong one tells them
nothing is wrong. A document naming neither SHALL appear with no payee named rather than being
hidden, since the obligation is real whether or not anyone recorded who holds it.

The queue SHALL be derived, not stored, and SHALL respect company isolation.

#### Scenario: Settled disbursement appears in the queue

- **GIVEN** a settled document in the active company whose accrual raised a trade payable and which has no payment yet
- **WHEN** a `PAYMENT_VIEW` user reads the ready-to-pay queue
- **THEN** the document appears with its vendor, payee bank account, amount owed, and GL

#### Scenario: An unpaid claim appears in the same queue

- **GIVEN** a fully approved document with no vendor whose accrual raised a claim payable and which has no payment yet
- **WHEN** the ready-to-pay queue is read
- **THEN** it appears in that queue, marked as a claim payable, and there is no second queue holding it

#### Scenario: A reimbursement names the person it is owed to

- **GIVEN** a fully approved document with no vendor that names an employee and whose accrual raised
  a claim payable
- **WHEN** the ready-to-pay queue is read
- **THEN** that employee is shown as who is owed, and no payee bank account is shown

#### Scenario: A document owed to nobody named still appears

- **GIVEN** a fully approved unpaid document carrying neither a vendor nor an employee
- **WHEN** the ready-to-pay queue is read
- **THEN** it appears with no payee named, rather than being omitted or attributed to its author

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

### Requirement: Finance States the Document's Rate

The rate stated on a document's transfer slip SHALL become the document's own rate: the system SHALL
write it to `document.exchange_rate` and recompute `base_total_amount` and every line's
`base_line_amount` from it.

This is the point of the field. The person attaching the slip is the person who converted the money,
and the figure the bank gave them is the figure the document is worth. Recording it only against the
payment leaves the document, the budget and the books each carrying a number nobody paid.

Restating the rate SHALL be one operation with the budget adjustment it forces (see `budget-control`)
and the log entry that attributes it: all three commit together or none do.

#### Scenario: The stated rate becomes the document's rate

- **GIVEN** a document in approval, locked at one rate, with an approval step still to come
- **WHEN** a `PAYMENT_MANAGE` user states a different rate on its transfer slip
- **THEN** the document's rate, base total and line base amounts are all recomputed at the stated rate

#### Scenario: The recorded payment agrees with the document

- **GIVEN** a document whose rate was restated to what finance actually paid
- **WHEN** its payment is recorded
- **THEN** the locked rate and the actual rate are the same figure and the FX difference is zero

### Requirement: A Rate Is Stated Only While The Document Can Still Be Refused

Restating the rate SHALL be refused unless the document is `IN_APPROVAL` **and** at least one
approval step has not yet been decided. It SHALL also be refused once a payment exists for the
document.

Somebody must still be able to say no to the figure. On a route that ends with accounting, that is
accounting: they approve the number finance actually paid, not a number that changed after they
approved it. A refusal SHALL name the reason — that the document is past its last approval, or
already paid — rather than failing generically.

Earlier approvals SHALL NOT be invalidated by a restatement. Approval routing compares its bands
against the budget base, so where a `BUDGET_RATE` is configured no approver's authority band moves
beneath them; where it is not, the re-reservation is subject to the same over-limit policy as the
original.

#### Scenario: The last approver still signs the final figure

- **GIVEN** a document waiting on its final approval step
- **WHEN** finance restates the rate
- **THEN** it is accepted, and the final approver acts on the restated figure

#### Scenario: A document past its last approval is refused

- **GIVEN** a `COMPLETED` document
- **WHEN** a rate is stated on it
- **THEN** the request is refused naming that no approval remains, and nothing is written

#### Scenario: A paid document is refused

- **GIVEN** a document whose payment is already recorded
- **WHEN** a rate is stated on it
- **THEN** the request is refused naming the recorded payment, and nothing is written

### Requirement: Every Restatement Is Attributed

The system SHALL write an `approval_log` row for each restatement recording who stated the rate, the
rate before, the rate after, and when.

The approvals already given remain readable against the figure they were given on. Somebody
reconciling the month has to be able to see that the number moved, who moved it, and by how much —
otherwise a document that changed value mid-approval is indistinguishable from one that never did.

#### Scenario: The change is attributable afterwards

- **WHEN** finance restates a document's rate from one figure to another
- **THEN** the approval log carries a row naming the user, both rates, and the time

### Requirement: The Rate Is Stated Without Re-Attaching Evidence

The system SHALL accept a stated rate for a document on its own, without a file. Attaching a slip
SHALL continue to carry the rate as it does today.

A rate that can only travel with an upload is a rate that gets typed and discarded — which is what
happened, silently, to a correction finance had already made. Correcting the figure and attaching a
second copy of a slip already on file are different acts and SHALL NOT be the same request.

#### Scenario: A correction needs no second copy of the slip

- **GIVEN** a document whose slip is already attached
- **WHEN** finance states a corrected rate without attaching anything
- **THEN** the rate is stored, the document is restated, and no second slip is written

#### Scenario: Attaching a slip still states the rate

- **WHEN** finance attaches a slip that carries a rate
- **THEN** the slip records that rate and the document is restated from it

### Requirement: The Transfer Slip States How The Money Left

Attaching a transfer slip SHALL capture which of the company's accounts the money left — the main
account or the reserve account, from that closed pair — and the exchange rate the money actually
converted at, both stored on the `payment_attachment` record and returned wherever that slip is read.

They are captured HERE because here is when they are known. The money goes out, finance attaches the
slip at the approval step that demands one, and states the account and the day's rate while looking
at the transfer. No `payment` row exists at that moment, so the slip is what can carry the answers.

An account outside the pair SHALL be refused by name rather than stored, and a rate that is not
positive SHALL be refused — a zero rate is not a slow way of saying "no rate", it is a number that
would divide the FX computation.

#### Scenario: The slip names the account and the rate

- **GIVEN** a document waiting on a step that requires a transfer slip
- **WHEN** a `PAYMENT_MANAGE` user attaches the slip, chooses the reserve account and states the rate
- **THEN** the slip stores both, and reading the document's slips returns them

#### Scenario: A rate that is not positive is refused

- **WHEN** a slip is attached stating a rate of zero or less
- **THEN** the request is refused, no file reaches storage, and no slip is written

### Requirement: A Recorded Payment Adopts What The Slip Stated

Recording a payment SHALL take the account and the actual rate from the document's transfer slips
when the request does not state them, each from the most recently attached slip that states it — a
later slip correcting an earlier one takes effect, and it may correct one without restating the
other. A value on the request SHALL win over the slip's, and both SHALL be stored on the `payment`
record and returned wherever a recorded payment is read.

The rate SHALL NOT be defaulted by the server when neither the request nor any slip states one: the
request SHALL be refused instead. A rate the server invented would be the system claiming to know
what the bank did.

A hand-recorded transfer SHALL still be refused when neither the request nor any slip has said which
account it left. A payment a bank run produced SHALL NOT be required to carry it: that payment
already names the configured `bank_account` the run paid from, which answers the same question with
configuration rather than a claim. This is the boundary the evidence rule already draws.

Cash SHALL NOT be asked: cash left no bank account, and a field nobody can answer truthfully is one
that gets filled with anything.

It is a statement by the person recording the payment, not a reference to configuration. It SHALL
NOT be derived from, validated against, or written into `payment.bank_account_id`, which names a
configured `bank_account` row. A payment carrying this choice and no `bank_account_id` SHALL keep
appearing in the unattributed-payments report, because it is still not attributed to a configured
account.

#### Scenario: A payment nobody has stated a rate for is refused

- **GIVEN** a document evidenced by a slip that states no rate
- **WHEN** a payment is recorded without one
- **THEN** the request is refused and no payment is written

#### Scenario: The payment adopts what the slip said

- **GIVEN** a document whose transfer slip says the reserve account
- **WHEN** the payment is recorded without naming an account
- **THEN** the payment stores the reserve account, and reading the payment returns it

#### Scenario: A later slip corrects an earlier one

- **GIVEN** a document with one slip saying the main account and a later one saying the reserve
- **WHEN** the payment is recorded without naming an account
- **THEN** the payment stores the reserve account

#### Scenario: The record's own statement wins

- **GIVEN** a document whose slip says the main account
- **WHEN** a transfer is recorded naming the reserve account
- **THEN** the payment stores the reserve account

#### Scenario: The ready-to-pay queue carries what the slip said

- **GIVEN** a document whose transfer slip names an account and a rate
- **WHEN** the ready-to-pay queue is read
- **THEN** that document's row carries both, so the record form does not ask a second time

#### Scenario: Cash is not asked which account it left

- **WHEN** a `PAYMENT_MANAGE` user records a cash payment
- **THEN** the choice is not required, and the payment is recorded without it

#### Scenario: A transfer nobody has said anything about is refused

- **GIVEN** a document evidenced by a slip that states no account
- **WHEN** a transfer is recorded by hand without naming the main or the reserve account
- **THEN** the request is refused and no payment is written

#### Scenario: A bank run's payment is not asked

- **WHEN** a payment batch result is imported
- **THEN** its payments are recorded without the choice, carrying the run's configured bank account

#### Scenario: An unknown account kind is refused by name

- **WHEN** a payment is recorded naming an account kind outside the main/reserve pair
- **THEN** the request is refused with an error naming the value, and no payment is written

#### Scenario: The choice does not attribute a payment to a configured account

- **GIVEN** a payment recorded from the reserve account with no `bank_account_id`
- **WHEN** the unattributed-payments report is read
- **THEN** that payment is still listed as unattributed

### Requirement: A Document Paid Before It Completed Records Itself

When a document becomes payable on completion, the system SHALL record its payment from what its
transfer slips state, without waiting for anyone to enter it a second time.

This follows the order of events the business actually runs: the money leaves the bank first, finance
attaches the slip at the approval step that demands one and states there which account it left and at
what rate, and the document then finishes its remaining approvals. By the time it completes, every
fact the payment record needs has already been stated by the person who paid.

It SHALL record only when the slips state BOTH the account and the rate, and SHALL record at most
once however often completion is signalled. Where they state less than both, where a payment already
exists, or where the recording fails for any reason, the document SHALL remain in the ready-to-pay
queue to be recorded by hand — the automatic path SHALL NOT be the only way a payment can be written.

Recording this way SHALL be identical to recording it by hand in every other respect: the same owed
predicate, the same FX computation, the same `payment.settled` signal to accounting, and no
`budget_txn` (invariant 3 — the budget settled to ACTUAL when the document completed).

It SHALL NOT disturb the approval that triggered it. The approval is already committed, and a failure
to record SHALL be reported rather than propagated.

#### Scenario: The payment writes itself when the document completes

- **GIVEN** a document whose transfer slip states the reserve account and the day's rate
- **WHEN** the document completes and becomes payable
- **THEN** its payment is recorded from the slip, and the document leaves the ready-to-pay queue

#### Scenario: Half an answer is left for a person

- **GIVEN** a document whose slip states an account but no rate, or a rate but no account
- **WHEN** the document completes
- **THEN** no payment is recorded and the document waits in the ready-to-pay queue

#### Scenario: Completion signalled twice records one payment

- **GIVEN** a document already recorded from its slip
- **WHEN** completion is signalled again
- **THEN** nothing further is written and the existing payment stands

#### Scenario: Recording itself charges the budget nothing

- **GIVEN** a document that records its own payment on completion
- **WHEN** the budget ledger is read
- **THEN** no `budget_txn` row was written for that payment

### Requirement: The Ready-to-Pay Queue Carries Each Document's Locked Rate

Each row of the ready-to-pay queue SHALL carry the exchange rate stamped on that document at submit,
so the record-payment form can offer it as the starting value for the actual rate. The queue SHALL
report it as stamped and SHALL NOT recompute it (invariant 6).

#### Scenario: The queue reports the rate the document locked

- **GIVEN** a document submitted at a locked rate
- **WHEN** the ready-to-pay queue is read
- **THEN** that document's row carries that rate, unchanged

