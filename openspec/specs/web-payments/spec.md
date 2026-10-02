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

### Requirement: The Rate Is Its Own Field, With Its Own Save

The transfer-slip panel SHALL let the rate be corrected and saved on its own, without attaching a
file, and SHALL show whether the figure on screen has been saved.

A field whose value only travels with a file upload is a field that accepts a correction and throws
it away — which is what happened to a rate finance had already typed, with nothing on screen to say
so. The control SHALL make the difference between "typed" and "stored" visible.

Attaching a slip SHALL continue to carry the rate shown, so the common case stays one action.

#### Scenario: A correction saves on its own

- **GIVEN** a document whose slip is already attached
- **WHEN** finance edits the rate and saves it
- **THEN** the rate is stored without a file being attached, and the screen shows it as saved

#### Scenario: An unsaved edit is visibly unsaved

- **GIVEN** finance has typed a rate different from the stored one
- **WHEN** they look at the panel
- **THEN** it shows the figure as not yet saved

### Requirement: The Panel States What Restating Will Do, Before It Is Done

The panel SHALL show what the stated rate will make the document worth, and what it will do to the
budget, before the rate is saved.

Restating changes the document's value and moves a budget reservation. Both are consequences the
person stating the rate is answerable for, and neither is visible from a number in a box. Where the
stated rate equals the document's current one, the panel SHALL say that instead of showing a change
of zero.

#### Scenario: The effect is shown before it is applied

- **GIVEN** a document worth one amount at its current rate
- **WHEN** finance types a different rate
- **THEN** the panel shows what the document will be worth at that rate before anything is saved

#### Scenario: An unchanged rate is stated as unchanged

- **WHEN** the rate typed equals the document's current rate
- **THEN** the panel says so rather than showing a nil change

### Requirement: The Rate Is Not Offered Where It Would Be Refused

The panel SHALL withdraw the rate control — and say why — when the document is past its last
approval, or already has a recorded payment.

The server refuses those cases, and a screen that offers an edit the server will refuse teaches
people that the screen lies. What was stated SHALL still be shown; only the ability to change it goes.

#### Scenario: A paid document shows the rate without offering to change it

- **GIVEN** a document whose payment is recorded
- **WHEN** the slip panel is opened
- **THEN** the stated rate is shown, the editable control is gone, and the reason is stated

#### Scenario: A document past its last approval is not offered the control

- **GIVEN** a `COMPLETED` document
- **WHEN** the slip panel is opened
- **THEN** the rate cannot be edited and the reason is stated

### Requirement: The Slip Panel Asks Which Account Pays

The transfer-slip panel SHALL collect a choice between the company's main account and its reserve
account, presented as two radio buttons so both options are visible at once — the point is to confirm
which account pays, and a choice hidden inside a dropdown is one that gets left at its default — and
the exchange rate the money actually converted at.

The rate field SHALL start from the rate the document locked at submit, where the caller knows it, so
finance corrects a figure instead of retyping one; where no locked rate is known it SHALL start
empty rather than at an invented value. It SHALL remain editable, because the bank decides the rate,
not the document, and what is submitted SHALL be what is recorded.

It is asked here, and not first on the record-payment screen, because here is where the answer is
known: the person attaching the slip is the person who paid, and they are looking at the transfer as
they do it. The panel appears at the approval step that requires a slip, on the paid document, and in
the record-payment confirmation — the same panel in all three.

The panel SHALL NOT attach a slip until the account is chosen and the rate is a positive number, and
SHALL say why the control is unavailable rather than presenting a disabled button with no reason.
Where an earlier slip on the document already states either, the field SHALL arrive carrying it, so
attaching a second slip confirms rather than re-asks; both SHALL remain editable, because a later
slip may correct an earlier one.

Each slip's stated account and rate SHALL be shown beside the file it belongs to.

#### Scenario: Attaching a slip asks which account and at what rate

- **WHEN** a `PAYMENT_MANAGE` user opens the transfer-slip panel
- **THEN** the main/reserve radio pair and the actual-rate field are shown beside the attach control

#### Scenario: The rate starts at the document's locked rate

- **GIVEN** a document locked at a rate, and no slip stating one
- **WHEN** the panel is opened
- **THEN** the rate field already holds the document's locked rate, and can still be changed

#### Scenario: A slip cannot be attached before both are stated

- **GIVEN** no account has been chosen, or the rate is empty or not a positive number
- **WHEN** the user looks at the attach control
- **THEN** it is unavailable, the reason is stated, and no upload is sent

#### Scenario: The edited rate is what is sent

- **GIVEN** the rate field started at the document's locked rate
- **WHEN** the user changes it and attaches the slip
- **THEN** the slip is stored with the rate they typed

#### Scenario: A second slip confirms rather than re-asks

- **GIVEN** a document whose slip already names the reserve account
- **WHEN** the panel is opened again
- **THEN** the reserve account is already chosen, and can still be changed

#### Scenario: What was stated is shown beside the file

- **GIVEN** a slip attached from the reserve account
- **WHEN** the document's slips are read
- **THEN** the reserve account is shown beside that slip

### Requirement: The Record Form Is The Fallback, Not The Route

A document whose transfer slip states both the account and the rate SHALL record itself on completion
and never reach the record-payment form. The form remains for the documents that do reach it — one paid
in cash, one whose slip predates these fields — and SHALL NOT ask again for anything already stated.

The record-payment form SHALL arrive with the account already chosen and the rate already filled from
the document's transfer slip when one states them, falling back to the document's locked rate for the
rate, and SHALL ask only for what nothing has said yet. It SHALL be shown only when
the method is a transfer and SHALL disappear when the method is cash, and the form SHALL NOT offer to
submit a transfer until an account is chosen.

A recorded payment's account SHALL be shown wherever that payment is read back, so the person
checking it later sees what the person paying stated.

#### Scenario: The slip's answers arrive with the form

- **GIVEN** a document whose transfer slip names the reserve account and a rate
- **WHEN** a `PAYMENT_MANAGE` user opens the record-payment form
- **THEN** the reserve account is already chosen and the rate field holds the slip's rate

#### Scenario: Choosing cash asks nothing about accounts

- **WHEN** the user chooses cash
- **THEN** the main/reserve choice is not shown, and the form can be submitted without it

#### Scenario: An incomplete transfer cannot be submitted

- **GIVEN** the method is transfer and nothing has named an account
- **WHEN** the user looks at the confirm action
- **THEN** it is disabled, and no request is sent

#### Scenario: What was stated is shown when the payment is read

- **GIVEN** a payment recorded from the reserve account
- **WHEN** it is read back
- **THEN** the reserve-account choice is shown

### Requirement: The Actual Rate Starts From The Document's Locked Rate

The record-payment form SHALL pre-fill the actual exchange rate with the rate the document locked at
submit, and SHALL let the user change it before recording. What is submitted SHALL be what is
recorded: pre-filling is a starting point, not a default the server substitutes.

Finance confirms or corrects the rate the money actually converted at; retyping a figure the document
already carries is how a digit gets dropped.

#### Scenario: The rate is offered, not demanded

- **WHEN** a `PAYMENT_MANAGE` user opens the record-payment form for a document locked at a rate
- **THEN** the actual-rate field already holds that rate

#### Scenario: A corrected rate is what gets recorded

- **WHEN** the user changes the pre-filled rate and records the payment
- **THEN** the payment is recorded at the rate they submitted

