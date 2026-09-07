## ADDED Requirements

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

#### Scenario: The slip names the account and the rate

- **GIVEN** a document waiting on a step that requires a transfer slip
- **WHEN** a `PAYMENT_MANAGE` user attaches the slip, chooses the reserve account and states the rate
- **THEN** the slip stores both, and reading the document's slips returns them

#### Scenario: A rate that is not positive is refused

- **WHEN** a slip is attached stating a rate of zero or less
- **THEN** the request is refused, no file reaches storage, and no slip is written

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
