# web-payments

## MODIFIED Requirements

### Requirement: Ready-to-Pay List

The web app SHALL show a `PAYMENT_VIEW` user the active company's ready-to-pay queue — every
obligation the company owes and has not paid — with who is owed, the kind of payable, the amount, and
the GL account(s), each linking to the source document. A `PAYMENT_MANAGE` user SHALL be able to
record a payment from the list; on success the disbursement leaves the queue and any FX gain/loss is
shown.

The list SHALL show a document owed to a vendor and one owed to a person side by side, marked by kind
rather than separated onto different screens. A finance user SHALL NOT need to know a document type's
configuration to find what they are supposed to pay: the queue answers what is owed, and which flow
produced the obligation is not a question the person paying it has to answer first.

The record-payment form SHALL collect the method the money moved by, a reference, and — where the
payment is not produced by a bank batch — the evidence file the server requires, in the one submission
that records the payment. A form that records first and asks for evidence afterwards produces payments
nobody is obliged to justify.

Where the server refuses a payment — for missing evidence, an unsupported method, or a document
already paid — the screen SHALL surface the server's message as returned, and SHALL NOT offer a
control that records the payment regardless.

The list and its navigation SHALL be shown only to users holding `PAYMENT_VIEW`, and the
record-payment affordance only to `PAYMENT_MANAGE` (UX only; the server enforces and scopes by
company).

#### Scenario: Lists everything owed

- **WHEN** a `PAYMENT_VIEW` user opens the ready-to-pay list
- **THEN** the active company's unpaid obligations are listed with who is owed, the kind, amount, and GL

#### Scenario: A vendor invoice and a claim appear together

- **GIVEN** one unpaid document owed to a vendor and one owed to a person
- **WHEN** the list renders
- **THEN** both are listed, each marked with its kind, and there is no second screen to visit

#### Scenario: Record a payment and see the FX result

- **WHEN** a `PAYMENT_MANAGE` user records a payment with an actual rate
- **THEN** the FX gain/loss is shown and the disbursement is removed from the queue

#### Scenario: A hand-recorded payment asks for its evidence up front

- **WHEN** a `PAYMENT_MANAGE` user records a payment for a document no batch holds
- **THEN** the form requires the evidence file with the record, in one submission

#### Scenario: A server refusal is shown as returned

- **GIVEN** a payment the server refuses
- **WHEN** the refusal arrives
- **THEN** its message is shown, and no control is offered that records the payment anyway

#### Scenario: Empty queue

- **WHEN** nothing is ready to pay
- **THEN** the list shows an empty state rather than an error

#### Scenario: Record affordance hidden without permission

- **WHEN** a user without `PAYMENT_MANAGE` views the list
- **THEN** the record-payment action is not shown
