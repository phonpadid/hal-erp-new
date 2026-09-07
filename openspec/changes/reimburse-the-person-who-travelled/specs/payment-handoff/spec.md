## MODIFIED Requirements

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
