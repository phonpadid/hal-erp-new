# web-payments Specification

## Purpose
TBD - created by archiving change procurement-post-actions. Update Purpose after archive.
## Requirements
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

### Requirement: Attach and View a Payment's Slips

The web app SHALL let a `PAYMENT_MANAGE` user attach one or more slips at the moment a payment is recorded, and SHALL show the slips of a paid disbursement on that document, each downloadable by a `PAYMENT_VIEW` user. Evidence SHALL remain reachable after payment: the ready-to-pay queue drops a disbursement as soon as it is paid, so the document it was raised from is where its slips are read. The upload affordance SHALL be shown only to a user holding `PAYMENT_MANAGE`, and the delete affordance only to one holding `PAYMENT_SLIP_DELETE`, mirroring the server's rules — the client guard is UX only. A paid disbursement with no slips SHALL say so rather than render an empty area.

#### Scenario: Attaching the bank's slip when recording a payment

- **GIVEN** a disbursement the user has just recorded a payment against
- **WHEN** the user uploads a slip without leaving the confirmation
- **THEN** the slip is attached to that payment and listed there

#### Scenario: The evidence outlives the queue entry

- **GIVEN** a disbursement that has been paid and has therefore left the ready-to-pay queue
- **WHEN** a `PAYMENT_VIEW` user opens that document
- **THEN** its slips are listed and can be downloaded

#### Scenario: Evidence controls follow the permission codes

- **GIVEN** a user holding `PAYMENT_VIEW` but neither `PAYMENT_MANAGE` nor `PAYMENT_SLIP_DELETE`
- **WHEN** the user opens a paid disbursement carrying a slip
- **THEN** the slip is listed with no upload control and no delete control

#### Scenario: A paid disbursement without evidence

- **WHEN** a user opens a paid disbursement that has no slips
- **THEN** the app states that no slip is attached

#### Scenario: A document that was never paid shows no evidence panel

- **WHEN** a user opens a document with no payment recorded against it
- **THEN** no evidence panel is shown, since there is nothing for a slip to be evidence of

### Requirement: Bank Accounts Are Configurable From The App

The web app SHALL provide a screen for the company's own bank accounts — listing them with the GL
account each one's balance lives in, creating one against an account of the same company, and
deactivating one — gated by `BANK_ACCOUNT_VIEW` for reading and `BANK_ACCOUNT_MANAGE` for the rest.

Deactivation SHALL be offered rather than deletion, because payments point at these rows.

#### Scenario: A reader sees the accounts without the management controls

- **GIVEN** a user holding `BANK_ACCOUNT_VIEW` without `BANK_ACCOUNT_MANAGE`
- **WHEN** the screen renders
- **THEN** the accounts are listed and no create or deactivate control is offered

#### Scenario: An account is created against a GL account

- **GIVEN** a user holding `BANK_ACCOUNT_MANAGE`
- **WHEN** they create a bank account naming a GL account
- **THEN** it is created and listed with that account

